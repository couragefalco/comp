export interface UploadOptions {
  /**
   * MIME type of the file
   */
  contentType?: string;
  /**
   * Cache-Control header value
   */
  cacheControl?: string;
  /**
   * Content-Disposition header (e.g., 'attachment; filename="file.pdf"')
   */
  contentDisposition?: string;
  /**
   * Custom metadata to store with the file
   */
  metadata?: Record<string, string>;
  /**
   * Access level: 'public' (default) or 'private'
   */
  access?: 'public' | 'private';
  /**
   * Add random suffix to prevent naming collisions (default: false)
   */
  addRandomSuffix?: boolean;
}

export interface UploadResult {
  /**
   * The URL to access the file
   */
  url: string;
  /**
   * The pathname/key of the stored file
   */
  pathname: string;
  /**
   * Content type of the uploaded file
   */
  contentType: string;
  /**
   * Size of the file in bytes
   */
  size: number;
}

export interface DownloadOptions {
  /**
   * Return as specific type
   */
  responseType?: 'buffer' | 'stream' | 'text';
}

export interface UrlOptions {
  /**
   * Expiration time in seconds (for signed URLs)
   */
  expiresIn?: number;
  /**
   * Force download instead of inline display
   */
  download?: boolean;
  /**
   * Custom filename for downloads
   */
  filename?: string;
  /**
   * Content type override for the response
   */
  contentType?: string;
}

export interface ListOptions {
  /**
   * Filter by path prefix
   */
  prefix?: string;
  /**
   * Maximum number of results
   */
  limit?: number;
  /**
   * Cursor for pagination
   */
  cursor?: string;
}

export interface ListResult {
  blobs: BlobInfo[];
  cursor?: string;
  hasMore: boolean;
}

export interface BlobInfo {
  pathname: string;
  url: string;
  size: number;
  uploadedAt: Date;
  contentType?: string;
}

export interface HeadResult {
  url: string;
  pathname: string;
  contentType: string;
  size: number;
  uploadedAt: Date;
  cacheControl?: string;
  contentDisposition?: string;
}

export interface StorageProvider {
  /**
   * Upload a file to storage
   */
  upload(
    pathname: string,
    data: Buffer | Blob | ArrayBuffer | ReadableStream | string,
    options?: UploadOptions
  ): Promise<UploadResult>;

  /**
   * Download a file from storage
   */
  download(pathname: string): Promise<Buffer>;

  /**
   * Download a file as a stream
   */
  downloadStream(pathname: string): Promise<ReadableStream>;

  /**
   * Get a URL to access the file
   * For Vercel Blob, returns the direct URL (public) or generates a token URL
   */
  getUrl(pathname: string, options?: UrlOptions): Promise<string>;

  /**
   * Delete a file from storage
   */
  delete(pathname: string): Promise<void>;

  /**
   * Delete multiple files from storage
   */
  deleteMany(pathnames: string[]): Promise<void>;

  /**
   * Copy a file to a new location
   * Note: Vercel Blob doesn't have native copy, so this downloads and re-uploads
   */
  copy(sourcePathname: string, destPathname: string): Promise<UploadResult>;

  /**
   * Check if a file exists
   */
  exists(pathname: string): Promise<boolean>;

  /**
   * Get file metadata without downloading
   */
  head(pathname: string): Promise<HeadResult | null>;

  /**
   * List files in storage
   */
  list(options?: ListOptions): Promise<ListResult>;
}

/**
 * Bucket prefix mapping for organizing files
 */
export type StorageBucket =
  | 'attachments'
  | 'questionnaires'
  | 'knowledge-base'
  | 'org-assets'
  | 'fleet-agents';

/**
 * Get the path prefix for a bucket
 */
export function getBucketPrefix(bucket: StorageBucket): string {
  return `${bucket}/`;
}

/**
 * Build a full pathname with bucket prefix
 */
export function buildPathname(bucket: StorageBucket, key: string): string {
  const cleanKey = key.startsWith('/') ? key.slice(1) : key;
  return `${getBucketPrefix(bucket)}${cleanKey}`;
}
