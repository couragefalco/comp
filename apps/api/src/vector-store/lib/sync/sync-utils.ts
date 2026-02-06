import { extractContentFromFile } from '@/trigger/vector-store/helpers/extract-content-from-file';
import { vectorIndex } from '../core/client';
import { batchUpsertEmbeddings } from '../core/upsert-embedding';
import { chunkText } from '../utils/chunk-text';
import { logger } from '../../logger';
import type { ExistingEmbedding } from '../core/find-existing-embeddings';
import { storage, STORAGE_BUCKETS } from '../../../app/storage';

export type SourceType =
  | 'policy'
  | 'context'
  | 'manual_answer'
  | 'knowledge_base_document';

export interface SyncStats {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  total: number;
  /** The last embedding ID that was upserted (for verification) */
  lastUpsertedEmbeddingId: string | null;
}

export interface ChunkItem {
  id: string;
  text: string;
  metadata: {
    organizationId: string;
    sourceType: SourceType;
    sourceId: string;
    content: string;
    updatedAt: string;
    [key: string]: string;
  };
}

/**
 * Extracts content from a Knowledge Base document stored in storage
 */
export async function extractContentFromS3Document(
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

  return extractContentFromFile(base64Data, detectedFileType);
}

/**
 * Check if embeddings need to be updated based on updatedAt timestamp
 */
export function needsUpdate(
  existingEmbeddings: ExistingEmbedding[],
  updatedAt: string,
): boolean {
  return (
    existingEmbeddings.length === 0 ||
    existingEmbeddings.some((e) => !e.updatedAt || e.updatedAt < updatedAt)
  );
}

/**
 * Delete old embeddings by IDs
 */
export async function deleteOldEmbeddings(
  embeddings: ExistingEmbedding[],
  logContext: Record<string, string>,
): Promise<void> {
  if (embeddings.length === 0 || !vectorIndex) {
    return;
  }

  const idsToDelete = embeddings.map((e) => e.id);
  try {
    await vectorIndex.delete(idsToDelete);
  } catch (error) {
    logger.warn('Failed to delete old embeddings', {
      ...logContext,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Create chunk items from text for embedding
 */
export function createChunkItems(
  text: string,
  sourceId: string,
  sourceType: SourceType,
  organizationId: string,
  updatedAt: string,
  idPrefix: string,
  extraMetadata: Record<string, string> = {},
  chunkSize = 500,
  overlap = 50,
): ChunkItem[] {
  const chunks = chunkText(text, chunkSize, overlap);

  return chunks
    .map((chunk, chunkIndex) => ({
      id: `${idPrefix}_${sourceId}_chunk${chunkIndex}`,
      text: chunk,
      metadata: {
        organizationId,
        sourceType,
        sourceId,
        content: chunk,
        updatedAt,
        ...extraMetadata,
      },
    }))
    .filter((item) => item.text && item.text.trim().length > 0);
}

/**
 * Upsert chunk items to vector store
 */
export async function upsertChunks(chunkItems: ChunkItem[]): Promise<void> {
  if (chunkItems.length > 0) {
    await batchUpsertEmbeddings(chunkItems);
  }
}

/**
 * Initialize sync stats
 */
export function initSyncStats(total: number): SyncStats {
  return {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    total,
    lastUpsertedEmbeddingId: null,
  };
}
