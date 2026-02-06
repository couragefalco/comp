import { randomBytes } from 'crypto';
import {
  storage,
  STORAGE_BUCKETS,
  base64ToBuffer,
} from '../../app/storage';
import {
  MAX_FILE_SIZE_BYTES,
  SIGNED_URL_EXPIRATION_SECONDS,
  sanitizeFileName,
  sanitizeMetadataFileName,
  generateS3Key,
} from './constants';

export interface UploadResult {
  s3Key: string;
  fileSize: number;
}

export interface SignedUrlResult {
  signedUrl: string;
}

/**
 * Validates that storage is configured
 */
export function validateS3Config(): void {
  // Storage is always available via the storage module
  // This function is kept for backward compatibility
}

/**
 * Uploads a document to storage
 */
export async function uploadToS3(
  organizationId: string,
  fileName: string,
  fileType: string,
  fileData: string,
): Promise<UploadResult> {
  // Convert base64 to buffer
  const fileBuffer = base64ToBuffer(fileData);

  // Validate file size
  if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `File exceeds the ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB limit`,
    );
  }

  // Generate unique file key
  const fileId = randomBytes(16).toString('hex');
  const sanitized = sanitizeFileName(fileName);
  const s3Key = `${STORAGE_BUCKETS.KNOWLEDGE_BASE}/${generateS3Key(organizationId, fileId, sanitized)}`;

  // Upload to storage
  await storage.upload(s3Key, fileBuffer, {
    contentType: fileType,
    metadata: {
      originalFileName: sanitizeMetadataFileName(fileName),
      organizationId,
    },
  });

  return {
    s3Key,
    fileSize: fileBuffer.length,
  };
}

/**
 * Generates a signed URL for downloading a document
 */
export async function generateDownloadUrl(
  s3Key: string,
  fileName: string,
): Promise<SignedUrlResult> {
  const signedUrl = await storage.getUrl(s3Key, {
    expiresIn: SIGNED_URL_EXPIRATION_SECONDS,
    download: true,
    filename: encodeURIComponent(fileName),
  });

  return { signedUrl };
}

/**
 * Generates a signed URL for viewing a document in browser
 */
export async function generateViewUrl(
  s3Key: string,
  fileName: string,
  fileType: string,
): Promise<SignedUrlResult> {
  const signedUrl = await storage.getUrl(s3Key, {
    expiresIn: SIGNED_URL_EXPIRATION_SECONDS,
    download: false,
    filename: encodeURIComponent(fileName),
    contentType: fileType || 'application/octet-stream',
  });

  return { signedUrl };
}

/**
 * Deletes a document from storage
 * Returns true if successful, false if error (non-throwing)
 */
export async function deleteFromS3(s3Key: string): Promise<boolean> {
  try {
    await storage.delete(s3Key);
    return true;
  } catch {
    return false;
  }
}
