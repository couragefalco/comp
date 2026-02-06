import { VercelBlobProvider } from './blob-provider';
import type { StorageProvider } from './types';

// Export types
export type {
  StorageProvider,
  UploadOptions,
  UploadResult,
  DownloadOptions,
  UrlOptions,
  ListOptions,
  ListResult,
  BlobInfo,
  HeadResult,
  StorageBucket,
} from './types';

// Export utilities
export {
  validatePathname,
  extractPathnameFromUrl,
  generateUniqueFilename,
  getContentTypeFromFilename,
  base64ToBuffer,
  bufferToBase64,
  buildOrgPath,
  parseOrgPath,
} from './utils';

// Export bucket helpers
export { getBucketPrefix, buildPathname } from './types';

// Export provider class for advanced use cases
export { VercelBlobProvider } from './blob-provider';

/**
 * Default storage instance using Vercel Blob
 * Uses BLOB_READ_WRITE_TOKEN from environment
 */
let storageInstance: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (!storageInstance) {
    storageInstance = new VercelBlobProvider();
  }
  return storageInstance;
}

/**
 * Pre-configured storage client for convenience
 * @example
 * import { storage } from '@comp/storage';
 * await storage.upload('path/to/file.pdf', buffer);
 */
export const storage = new Proxy({} as StorageProvider, {
  get(_, prop: keyof StorageProvider) {
    return (...args: unknown[]) => {
      const instance = getStorage();
      const method = instance[prop];
      if (typeof method === 'function') {
        return (method as Function).apply(instance, args);
      }
      return method;
    };
  },
});

// Re-export Vercel Blob types for advanced usage
export { type PutBlobResult } from '@vercel/blob';

/**
 * Bucket prefixes for different storage types
 * Use these to organize files by purpose
 */
export const STORAGE_BUCKETS = {
  /** Task attachments, evidence files */
  ATTACHMENTS: 'attachments',
  /** Questionnaire uploads for parsing */
  QUESTIONNAIRES: 'questionnaires',
  /** Knowledge base documents for AI */
  KNOWLEDGE_BASE: 'knowledge-base',
  /** Organization assets: logos, favicons, certificates */
  ORG_ASSETS: 'org-assets',
  /** Device agent installers */
  FLEET_AGENTS: 'fleet-agents',
} as const;

/**
 * Legacy bucket name mapping for migration
 * Maps old S3 environment variable names to new bucket prefixes
 */
export const LEGACY_BUCKET_MAPPING = {
  APP_AWS_BUCKET_NAME: STORAGE_BUCKETS.ATTACHMENTS,
  APP_AWS_QUESTIONNAIRE_UPLOAD_BUCKET: STORAGE_BUCKETS.QUESTIONNAIRES,
  APP_AWS_KNOWLEDGE_BASE_BUCKET: STORAGE_BUCKETS.KNOWLEDGE_BASE,
  APP_AWS_ORG_ASSETS_BUCKET: STORAGE_BUCKETS.ORG_ASSETS,
  FLEET_AGENT_BUCKET_NAME: STORAGE_BUCKETS.FLEET_AGENTS,
} as const;
