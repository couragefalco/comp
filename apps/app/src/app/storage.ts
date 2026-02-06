/**
 * Storage module for the app
 * Provides file storage operations using Vercel Blob
 *
 * This replaces the old S3-based storage (s3.ts)
 */

import {
  storage,
  extractPathnameFromUrl,
  STORAGE_BUCKETS,
  base64ToBuffer,
  getContentTypeFromFilename,
  type UploadResult,
  type UrlOptions,
} from '@comp/storage';

// Re-export storage instance and utilities
export {
  storage,
  extractPathnameFromUrl,
  STORAGE_BUCKETS,
  base64ToBuffer,
  getContentTypeFromFilename,
};

// Re-export types
export type { UploadResult, UrlOptions };

/**
 * Legacy alias for extractPathnameFromUrl
 * @deprecated Use extractPathnameFromUrl instead
 */
export const extractS3KeyFromUrl = extractPathnameFromUrl;

/**
 * Legacy bucket name constants
 * @deprecated Use STORAGE_BUCKETS instead
 */
export const BUCKET_NAME = STORAGE_BUCKETS.ATTACHMENTS;
export const APP_AWS_QUESTIONNAIRE_UPLOAD_BUCKET = STORAGE_BUCKETS.QUESTIONNAIRES;
export const APP_AWS_KNOWLEDGE_BASE_BUCKET = STORAGE_BUCKETS.KNOWLEDGE_BASE;
export const APP_AWS_ORG_ASSETS_BUCKET = STORAGE_BUCKETS.ORG_ASSETS;

/**
 * Get fleet agent installer file
 */
export async function getFleetAgent({
  os,
}: {
  os: 'macos' | 'windows' | 'linux';
}): Promise<ReadableStream> {
  const fleetAgentFileName = 'Comp AI Agent-1.0.0-arm64.dmg';
  const pathname = `${STORAGE_BUCKETS.FLEET_AGENTS}/${os}/${fleetAgentFileName}`;

  return storage.downloadStream(pathname);
}

/**
 * Upload a file to storage
 */
export async function uploadFile(
  bucket: string,
  key: string,
  data: Buffer | string,
  options?: {
    contentType?: string;
    cacheControl?: string;
    metadata?: Record<string, string>;
  }
): Promise<UploadResult> {
  const buffer = typeof data === 'string' ? base64ToBuffer(data) : data;
  const pathname = `${bucket}/${key}`;

  return storage.upload(pathname, buffer, {
    contentType: options?.contentType,
    cacheControl: options?.cacheControl,
    metadata: options?.metadata,
  });
}

/**
 * Download a file from storage
 */
export async function downloadFile(bucket: string, key: string): Promise<Buffer> {
  const pathname = `${bucket}/${key}`;
  return storage.download(pathname);
}

/**
 * Get a signed/accessible URL for a file
 */
export async function getFileUrl(
  bucket: string,
  key: string,
  options?: UrlOptions
): Promise<string> {
  const pathname = `${bucket}/${key}`;
  return storage.getUrl(pathname, options);
}

/**
 * Delete a file from storage
 */
export async function deleteFile(bucket: string, key: string): Promise<void> {
  const pathname = `${bucket}/${key}`;
  return storage.delete(pathname);
}

/**
 * Delete multiple files from storage
 */
export async function deleteFiles(bucket: string, keys: string[]): Promise<void> {
  const pathnames = keys.map((key) => `${bucket}/${key}`);
  return storage.deleteMany(pathnames);
}

/**
 * Copy a file to a new location
 */
export async function copyFile(
  sourceBucket: string,
  sourceKey: string,
  destBucket: string,
  destKey: string
): Promise<UploadResult> {
  const sourcePath = `${sourceBucket}/${sourceKey}`;
  const destPath = `${destBucket}/${destKey}`;
  return storage.copy(sourcePath, destPath);
}

/**
 * Check if a file exists
 */
export async function fileExists(bucket: string, key: string): Promise<boolean> {
  const pathname = `${bucket}/${key}`;
  return storage.exists(pathname);
}
