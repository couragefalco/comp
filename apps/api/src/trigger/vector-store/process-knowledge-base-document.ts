import { logger, task } from '@trigger.dev/sdk';
import { db } from '@db';
import { batchUpsertEmbeddings } from '@/vector-store/lib/core/upsert-embedding';
import { chunkText } from '@/vector-store/lib/utils/chunk-text';
import { findEmbeddingsForSource } from '@/vector-store/lib/core/find-existing-embeddings';
import { vectorIndex } from '@/vector-store/lib/core/client';
import { extractContentFromFile } from './helpers/extract-content-from-file';
import { storage, STORAGE_BUCKETS } from '../../app/storage';

/**
 * Extracts content from a Knowledge Base document stored in storage
 */
async function extractContentFromKnowledgeBaseDocument(
  s3Key: string,
  fileType: string,
): Promise<string> {
  const pathname = `${STORAGE_BUCKETS.KNOWLEDGE_BASE}/${s3Key}`;
  const buffer = await storage.download(pathname);

  if (!buffer) {
    throw new Error('Failed to retrieve file from storage');
  }

  const base64Data = buffer.toString('base64');

  // Get file metadata to determine content type
  const headResult = await storage.head(pathname);
  const detectedFileType =
    headResult?.contentType || fileType || 'application/octet-stream';

  const content = await extractContentFromFile(base64Data, detectedFileType);

  return content;
}

/**
 * Task to process a Knowledge Base document and add it to the vector database
 * Supports: PDF, Excel (.xlsx, .xls), CSV, text files (.txt, .md), Word documents (.docx), images (PNG, JPG, GIF, WebP, SVG)
 */
export const processKnowledgeBaseDocumentTask = task({
  id: 'process-knowledge-base-document',
  retry: {
    maxAttempts: 3,
  },
  maxDuration: 1000 * 60 * 30, // 30 minutes for large files
  run: async (payload: { documentId: string; organizationId: string }) => {
    logger.info('Processing Knowledge Base document', {
      documentId: payload.documentId,
      organizationId: payload.organizationId,
    });

    try {
      // Fetch document from database
      const document = await db.knowledgeBaseDocument.findUnique({
        where: {
          id: payload.documentId,
          organizationId: payload.organizationId,
        },
      });

      if (!document) {
        logger.error('Document not found', {
          documentId: payload.documentId,
          organizationId: payload.organizationId,
        });
        return {
          success: false,
          documentId: payload.documentId,
          error: 'Document not found',
        };
      }

      // Update status to processing
      await db.knowledgeBaseDocument.update({
        where: { id: document.id },
        data: { processingStatus: 'processing' },
      });

      // Extract content from file in S3
      logger.info('Extracting content from file', {
        documentId: document.id,
        s3Key: document.s3Key,
        fileType: document.fileType,
      });

      const content = await extractContentFromKnowledgeBaseDocument(
        document.s3Key,
        document.fileType,
      );

      if (!content || content.trim().length === 0) {
        logger.warn('No content extracted from document', {
          documentId: document.id,
        });
        await db.knowledgeBaseDocument.update({
          where: { id: document.id },
          data: {
            processingStatus: 'failed',
            processedAt: new Date(),
          },
        });
        return {
          success: false,
          documentId: document.id,
          error: 'No content extracted from document',
        };
      }

      logger.info('Content extracted successfully', {
        documentId: document.id,
        contentLength: content.length,
      });

      // Delete existing embeddings for this document (if any)
      const existingEmbeddings = await findEmbeddingsForSource(
        document.id,
        'knowledge_base_document',
        payload.organizationId,
      );

      if (existingEmbeddings.length > 0) {
        if (vectorIndex) {
          const idsToDelete = existingEmbeddings.map((e) => e.id);
          try {
            await vectorIndex.delete(idsToDelete);
            logger.info('Deleted existing embeddings', {
              documentId: document.id,
              deletedCount: idsToDelete.length,
            });
          } catch (error) {
            logger.warn('Failed to delete existing embeddings', {
              documentId: document.id,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }
      }

      // Chunk content for embedding
      const chunks = chunkText(content, 500, 50);

      if (chunks.length === 0) {
        logger.warn('No chunks created from content', {
          documentId: document.id,
        });
        await db.knowledgeBaseDocument.update({
          where: { id: document.id },
          data: {
            processingStatus: 'failed',
            processedAt: new Date(),
          },
        });
        return {
          success: false,
          documentId: document.id,
          error: 'No chunks created from content',
        };
      }

      logger.info('Created chunks for embedding', {
        documentId: document.id,
        chunkCount: chunks.length,
      });

      // Create embeddings for each chunk
      const updatedAt = document.updatedAt.toISOString();
      const chunkItems = chunks
        .map((chunk, chunkIndex) => ({
          id: `knowledge_base_document_${document.id}_chunk${chunkIndex}`,
          text: chunk,
          metadata: {
            organizationId: payload.organizationId,
            sourceType: 'knowledge_base_document' as const,
            sourceId: document.id,
            content: chunk,
            documentName: document.name,
            updatedAt,
          },
        }))
        .filter((item) => item.text && item.text.trim().length > 0);

      if (chunkItems.length > 0) {
        await batchUpsertEmbeddings(chunkItems);
        logger.info('Successfully created embeddings', {
          documentId: document.id,
          embeddingCount: chunkItems.length,
        });
      }

      // Update status to completed
      await db.knowledgeBaseDocument.update({
        where: { id: document.id },
        data: {
          processingStatus: 'completed',
          processedAt: new Date(),
        },
      });

      logger.info('Successfully processed Knowledge Base document', {
        documentId: document.id,
        organizationId: payload.organizationId,
        chunkCount: chunkItems.length,
      });

      return {
        success: true,
        documentId: document.id,
        chunkCount: chunkItems.length,
      };
    } catch (error) {
      logger.error('Error processing Knowledge Base document', {
        documentId: payload.documentId,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined,
      });

      // Update status to failed
      try {
        await db.knowledgeBaseDocument.update({
          where: { id: payload.documentId },
          data: {
            processingStatus: 'failed',
            processedAt: new Date(),
          },
        });
      } catch (updateError) {
        logger.error('Failed to update document status to failed', {
          documentId: payload.documentId,
          error:
            updateError instanceof Error
              ? updateError.message
              : 'Unknown error',
        });
      }

      return {
        success: false,
        documentId: payload.documentId,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});
