import { AttachmentEntityType, AttachmentType, db } from '@db';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { AttachmentResponseDto } from '../tasks/dto/task-responses.dto';
import { UploadAttachmentDto } from './upload-attachment.dto';
import {
  storage,
  STORAGE_BUCKETS,
  base64ToBuffer,
} from '../app/storage';

@Injectable()
export class AttachmentsService {
  private bucketPrefix: string;
  private readonly MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
  private readonly SIGNED_URL_EXPIRY = 900; // 15 minutes

  constructor() {
    this.bucketPrefix = STORAGE_BUCKETS.ATTACHMENTS;
  }

  /**
   * Upload attachment to storage and create database record
   */
  async uploadAttachment(
    organizationId: string,
    entityId: string,
    entityType: AttachmentEntityType,
    uploadDto: UploadAttachmentDto,
    userId?: string,
  ): Promise<AttachmentResponseDto> {
    try {
      // Blocked file extensions for security
      const BLOCKED_EXTENSIONS = [
        'exe',
        'bat',
        'cmd',
        'com',
        'scr',
        'msi', // Windows executables
        'js',
        'vbs',
        'vbe',
        'wsf',
        'wsh',
        'ps1', // Scripts
        'sh',
        'bash',
        'zsh', // Shell scripts
        'dll',
        'sys',
        'drv', // System files
        'app',
        'deb',
        'rpm', // Application packages
        'jar', // Java archives (can execute)
        'pif',
        'lnk',
        'cpl', // Shortcuts and control panel
        'hta',
        'reg', // HTML apps and registry
      ];

      // Blocked MIME types for security
      const BLOCKED_MIME_TYPES = [
        'application/x-msdownload', // .exe
        'application/x-msdos-program',
        'application/x-executable',
        'application/x-sh', // Shell scripts
        'application/x-bat', // Batch files
        'text/x-sh',
        'text/x-python',
        'text/x-perl',
        'text/x-ruby',
        'application/x-httpd-php', // PHP files
        'application/x-javascript', // Executable JS (not JSON)
        'application/javascript',
        'text/javascript',
      ];

      // Validate file extension
      const fileExt = uploadDto.fileName.split('.').pop()?.toLowerCase();
      if (fileExt && BLOCKED_EXTENSIONS.includes(fileExt)) {
        throw new BadRequestException(
          `File extension '.${fileExt}' is not allowed for security reasons`,
        );
      }

      // Validate MIME type
      if (BLOCKED_MIME_TYPES.includes(uploadDto.fileType.toLowerCase())) {
        throw new BadRequestException(
          `File type '${uploadDto.fileType}' is not allowed for security reasons`,
        );
      }

      // Validate file size
      const fileBuffer = base64ToBuffer(uploadDto.fileData);
      if (fileBuffer.length > this.MAX_FILE_SIZE_BYTES) {
        throw new BadRequestException(
          `File size exceeds maximum allowed size of ${this.MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`,
        );
      }

      // Generate unique file key
      const fileId = randomBytes(16).toString('hex');
      const sanitizedFileName = this.sanitizeFileName(uploadDto.fileName);
      const timestamp = Date.now();

      // Storage path structure for task items: org_{orgId}/attachments/task-item/{entityType}/{entityId}
      let storageKey: string;
      if (entityType === 'task_item') {
        // For task items, extract entityType and entityId from metadata
        // Metadata should contain taskItemEntityType and taskItemEntityId
        const taskItemEntityType =
          uploadDto.description?.split('|')[0] || 'unknown';
        const taskItemEntityId =
          uploadDto.description?.split('|')[1] || entityId;
        storageKey = `${this.bucketPrefix}/${organizationId}/task-item/${taskItemEntityType}/${taskItemEntityId}/${timestamp}-${fileId}-${sanitizedFileName}`;
      } else {
        storageKey = `${this.bucketPrefix}/${organizationId}/${entityType}/${entityId}/${timestamp}-${fileId}-${sanitizedFileName}`;
      }

      // Upload to storage
      await storage.upload(storageKey, fileBuffer, {
        contentType: uploadDto.fileType,
        metadata: {
          originalFileName: this.sanitizeHeaderValue(uploadDto.fileName),
          organizationId,
          entityId,
          entityType,
          ...(userId && { uploadedBy: userId }),
        },
      });

      // Create database record
      const attachment = await db.attachment.create({
        data: {
          name: uploadDto.fileName,
          url: storageKey,
          type: this.mapFileTypeToAttachmentType(uploadDto.fileType),
          entityId,
          entityType,
          organizationId,
        },
      });

      // Generate URL for immediate access
      const downloadUrl = await this.generateSignedUrl(storageKey);

      return {
        id: attachment.id,
        name: attachment.name,
        type: attachment.type,
        downloadUrl,
        createdAt: attachment.createdAt,
        size: fileBuffer.length,
      };
    } catch (error) {
      console.error('Error uploading attachment:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to upload attachment');
    }
  }

  /**
   * Get all attachments for an entity WITH signed URLs (for backward compatibility)
   */
  async getAttachments(
    organizationId: string,
    entityId: string,
    entityType: AttachmentEntityType,
  ): Promise<AttachmentResponseDto[]> {
    const attachments = await db.attachment.findMany({
      where: {
        organizationId,
        entityId,
        entityType,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    // Generate signed URLs for all attachments
    const attachmentsWithUrls = await Promise.all(
      attachments.map(async (attachment) => {
        const downloadUrl = await this.generateSignedUrl(attachment.url);
        return {
          id: attachment.id,
          name: attachment.name,
          type: attachment.type,
          downloadUrl,
          createdAt: attachment.createdAt,
        };
      }),
    );

    return attachmentsWithUrls;
  }

  /**
   * Get attachment metadata WITHOUT signed URLs (for on-demand URL generation)
   */
  async getAttachmentMetadata(
    organizationId: string,
    entityId: string,
    entityType: AttachmentEntityType,
  ): Promise<{ id: string; name: string; type: string; createdAt: Date }[]> {
    const attachments = await db.attachment.findMany({
      where: {
        organizationId,
        entityId,
        entityType,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      type: attachment.type,
      createdAt: attachment.createdAt,
    }));
  }

  /**
   * Get download URL for an attachment
   */
  async getAttachmentDownloadUrl(
    organizationId: string,
    attachmentId: string,
  ): Promise<{ downloadUrl: string; expiresIn: number }> {
    try {
      // Get attachment record
      const attachment = await db.attachment.findFirst({
        where: {
          id: attachmentId,
          organizationId,
        },
      });

      if (!attachment) {
        throw new BadRequestException('Attachment not found');
      }

      // Generate signed URL
      const downloadUrl = await this.generateSignedUrl(attachment.url);

      return {
        downloadUrl,
        expiresIn: this.SIGNED_URL_EXPIRY,
      };
    } catch (error) {
      console.error('Error generating download URL:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to generate download URL');
    }
  }

  /**
   * Delete attachment from storage and database
   */
  async deleteAttachment(
    organizationId: string,
    attachmentId: string,
  ): Promise<void> {
    try {
      // Get attachment record
      const attachment = await db.attachment.findFirst({
        where: {
          id: attachmentId,
          organizationId,
        },
      });

      if (!attachment) {
        throw new BadRequestException('Attachment not found');
      }

      // Delete from storage
      await storage.delete(attachment.url);

      // Delete from database
      await db.attachment.delete({
        where: {
          id: attachmentId,
          organizationId,
        },
      });
    } catch (error) {
      console.error('Error deleting attachment:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete attachment');
    }
  }

  /**
   * Copy a policy PDF to a new storage key for versioning
   */
  async copyPolicyVersionPdf(
    sourceKey: string,
    destinationKey: string,
  ): Promise<string | null> {
    try {
      await storage.copy(sourceKey, destinationKey);
      return destinationKey;
    } catch (error) {
      console.error('Error copying policy PDF:', error);
      return null;
    }
  }

  /**
   * Delete a policy version PDF from storage
   */
  async deletePolicyVersionPdf(storageKey: string): Promise<void> {
    try {
      await storage.delete(storageKey);
    } catch (error) {
      console.error('Error deleting policy PDF:', error);
    }
  }

  /**
   * Generate signed URL for file download
   */
  private async generateSignedUrl(storageKey: string): Promise<string> {
    return storage.getUrl(storageKey, {
      expiresIn: this.SIGNED_URL_EXPIRY,
    });
  }

  async uploadToS3(
    fileBuffer: Buffer,
    fileName: string,
    contentType: string,
    organizationId: string,
    entityType: string,
    entityId: string,
  ): Promise<string> {
    const fileId = randomBytes(16).toString('hex');
    const sanitizedFileName = this.sanitizeFileName(fileName);
    const timestamp = Date.now();
    const storageKey = `${this.bucketPrefix}/${organizationId}/${entityType}/${entityId}/${timestamp}-${fileId}-${sanitizedFileName}`;

    await storage.upload(storageKey, fileBuffer, {
      contentType,
      metadata: {
        originalFileName: this.sanitizeHeaderValue(fileName),
        organizationId,
        entityId,
        entityType,
      },
    });

    return storageKey;
  }

  async getPresignedDownloadUrl(storageKey: string): Promise<string> {
    return this.generateSignedUrl(storageKey);
  }

  /**
   * Generate presigned download URL with a custom download filename
   */
  async getPresignedDownloadUrlWithFilename(
    storageKey: string,
    downloadFilename: string,
  ): Promise<string> {
    const sanitizedFilename = this.sanitizeHeaderValue(downloadFilename);
    return storage.getUrl(storageKey, {
      expiresIn: this.SIGNED_URL_EXPIRY,
      download: true,
      filename: sanitizedFilename,
    });
  }

  async getObjectBuffer(storageKey: string): Promise<Buffer> {
    return storage.download(storageKey);
  }

  private sanitizeFileName(fileName: string): string {
    return fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  }

  /**
   * Sanitize header value for storage metadata to avoid invalid characters
   * - Remove control characters (\x00-\x1F, \x7F)
   * - Replace non-ASCII with '_'
   * - Trim whitespace
   */
  private sanitizeHeaderValue(value: string): string {
    // eslint-disable-next-line no-control-regex
    const withoutControls = value.replace(/[\x00-\x1F\x7F]/g, '');
    const asciiOnly = withoutControls.replace(/[^\x20-\x7E]/g, '_');
    return asciiOnly.trim();
  }

  /**
   * Map MIME type to AttachmentType enum
   */
  private mapFileTypeToAttachmentType(fileType: string): AttachmentType {
    const type = fileType.split('/')[0];
    switch (type) {
      case 'image':
        return AttachmentType.image;
      case 'video':
        return AttachmentType.video;
      case 'audio':
        return AttachmentType.audio;
      case 'application':
      case 'text':
        return AttachmentType.document;
      default:
        return AttachmentType.other;
    }
  }
}
