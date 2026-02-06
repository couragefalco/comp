/**
 * @deprecated This file is deprecated. Import from './storage' instead.
 *
 * This file re-exports from storage.ts for backward compatibility during migration.
 * All S3 operations have been migrated to Vercel Blob storage.
 */

export {
  // Storage instance
  storage,

  // Utilities
  extractPathnameFromUrl,
  extractS3KeyFromUrl, // Legacy alias
  base64ToBuffer,
  getContentTypeFromFilename,

  // Bucket constants
  STORAGE_BUCKETS,
  BUCKET_NAME,
  APP_AWS_ORG_ASSETS_BUCKET,

  // Functions
  uploadFile,
  downloadFile,
  getFileUrl,
  deleteFile,
  deleteFiles,
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  getFleetAgent,
} from './storage';

export type { UploadResult, UrlOptions, SupportedOS } from './storage';

// Legacy s3Client export - this will cause a compile error if used
// Consumers need to switch to using the storage functions instead
// export const s3Client = null; // Removed - use storage instead
