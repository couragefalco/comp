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
  APP_AWS_QUESTIONNAIRE_UPLOAD_BUCKET,
  APP_AWS_KNOWLEDGE_BASE_BUCKET,
  APP_AWS_ORG_ASSETS_BUCKET,

  // Functions
  getFleetAgent,
  uploadFile,
  downloadFile,
  getFileUrl,
  deleteFile,
  deleteFiles,
  copyFile,
  fileExists,
} from './storage';

export type { UploadResult, UrlOptions } from './storage';

// Legacy exports that don't exist anymore - will cause compile errors if used
// This helps identify code that needs updating
// export const s3Client = null; // Removed - use storage instead
