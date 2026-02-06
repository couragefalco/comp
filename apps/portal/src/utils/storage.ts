/**
 * Storage module for the portal
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
import type { SupportedOS } from '@/app/api/download-agent/types';

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
export const APP_AWS_ORG_ASSETS_BUCKET = STORAGE_BUCKETS.ORG_ASSETS;

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
 * Get presigned upload URL (for client-side uploads)
 * Note: Vercel Blob handles this differently - returns a URL you can PUT to
 */
export async function getPresignedUploadUrl(
  bucket: string,
  key: string,
  options?: {
    contentType?: string;
    expiresIn?: number;
  }
): Promise<{ url: string; fields?: Record<string, string> }> {
  // For Vercel Blob, client uploads are handled differently
  // The client should use the upload API directly
  // This is a placeholder for backward compatibility
  const pathname = `${bucket}/${key}`;

  // Return a URL structure that indicates where to upload
  return {
    url: `/api/storage/upload?pathname=${encodeURIComponent(pathname)}`,
    fields: {
      pathname,
      contentType: options?.contentType || 'application/octet-stream',
    },
  };
}

/**
 * Get presigned download URL
 */
export async function getPresignedDownloadUrl(params: {
  bucketName: string;
  key: string;
  expiresIn?: number;
}): Promise<string> {
  return getFileUrl(params.bucketName, params.key, { expiresIn: params.expiresIn });
}

/**
 * Get fleet agent installer file
 */
export async function getFleetAgent({ os }: { os: SupportedOS }): Promise<ReadableStream> {
  const macosPackageFilename = 'Comp AI Agent-1.0.0-arm64.dmg';
  const windowsPackageFilename = 'fleet-osquery.msi';

  const filename = os === 'macos' || os === 'macos-intel' ? macosPackageFilename : windowsPackageFilename;
  const osFolder = os === 'macos-intel' ? 'macos' : os;
  const pathname = `${STORAGE_BUCKETS.FLEET_AGENTS}/${osFolder}/${filename}`;

  return storage.downloadStream(pathname);
}

// Re-export SupportedOS type for convenience
export type { SupportedOS };
