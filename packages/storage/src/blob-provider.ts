import {
  put,
  del,
  list,
  head,
  type PutBlobResult,
} from '@vercel/blob';
import type {
  StorageProvider,
  UploadOptions,
  UploadResult,
  UrlOptions,
  ListOptions,
  ListResult,
  HeadResult,
} from './types';

/**
 * Vercel Blob storage provider implementation
 */
export class VercelBlobProvider implements StorageProvider {
  private token: string;

  constructor(token?: string) {
    this.token = token || process.env.BLOB_READ_WRITE_TOKEN || '';
    if (!this.token) {
      console.warn('[Storage] BLOB_READ_WRITE_TOKEN not set - storage operations will fail');
    }
  }

  async upload(
    pathname: string,
    data: Buffer | Blob | ArrayBuffer | ReadableStream | string,
    options?: UploadOptions
  ): Promise<UploadResult> {
    const result: PutBlobResult = await put(pathname, data, {
      access: 'public', // Vercel Blob only supports public access
      token: this.token,
      contentType: options?.contentType,
      cacheControlMaxAge: options?.cacheControl
        ? this.parseCacheControl(options.cacheControl)
        : undefined,
      addRandomSuffix: options?.addRandomSuffix ?? false,
    });

    return {
      url: result.url,
      pathname: result.pathname,
      contentType: result.contentType,
      size: 0, // Vercel Blob doesn't return size on upload
    };
  }

  async download(pathname: string): Promise<Buffer> {
    const url = this.resolveUrl(pathname);
    const response = await fetch(url, {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
    });

    if (!response.ok) {
      throw new Error(`Failed to download ${pathname}: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async downloadStream(pathname: string): Promise<ReadableStream> {
    const url = this.resolveUrl(pathname);
    const response = await fetch(url, {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
    });

    if (!response.ok) {
      throw new Error(`Failed to download ${pathname}: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error(`No body in response for ${pathname}`);
    }

    return response.body;
  }

  async getUrl(pathname: string, options?: UrlOptions): Promise<string> {
    // For Vercel Blob, public files have direct URLs
    // We need to get the head to find the URL if we only have the pathname
    const headResult = await this.head(pathname);

    if (!headResult) {
      throw new Error(`File not found: ${pathname}`);
    }

    let url = headResult.url;

    // Add download parameter if needed
    if (options?.download && options?.filename) {
      const urlObj = new URL(url);
      urlObj.searchParams.set('download', options.filename);
      url = urlObj.toString();
    } else if (options?.download) {
      const urlObj = new URL(url);
      urlObj.searchParams.set('download', '1');
      url = urlObj.toString();
    }

    return url;
  }

  async delete(pathname: string): Promise<void> {
    const url = this.resolveUrl(pathname);
    await del(url, { token: this.token });
  }

  async deleteMany(pathnames: string[]): Promise<void> {
    if (pathnames.length === 0) return;

    const urls = pathnames.map((p) => this.resolveUrl(p));
    await del(urls, { token: this.token });
  }

  async copy(sourcePathname: string, destPathname: string): Promise<UploadResult> {
    // Vercel Blob doesn't have native copy, so download and re-upload
    const data = await this.download(sourcePathname);
    const headResult = await this.head(sourcePathname);

    return this.upload(destPathname, data, {
      contentType: headResult?.contentType,
    });
  }

  async exists(pathname: string): Promise<boolean> {
    const result = await this.head(pathname);
    return result !== null;
  }

  async head(pathname: string): Promise<HeadResult | null> {
    try {
      const url = this.resolveUrl(pathname);
      const result = await head(url, { token: this.token });

      if (!result) return null;

      return {
        url: result.url,
        pathname: result.pathname,
        contentType: result.contentType,
        size: result.size,
        uploadedAt: result.uploadedAt,
        cacheControl: result.cacheControl,
        contentDisposition: result.contentDisposition,
      };
    } catch {
      return null;
    }
  }

  async list(options?: ListOptions): Promise<ListResult> {
    const result = await list({
      token: this.token,
      prefix: options?.prefix,
      limit: options?.limit,
      cursor: options?.cursor,
    });

    return {
      blobs: result.blobs.map((blob) => ({
        pathname: blob.pathname,
        url: blob.url,
        size: blob.size,
        uploadedAt: blob.uploadedAt,
      })),
      cursor: result.cursor,
      hasMore: result.hasMore,
    };
  }

  /**
   * Resolve a pathname to a full URL
   * If the pathname is already a URL, return it as-is
   */
  private resolveUrl(pathname: string): string {
    if (pathname.startsWith('http://') || pathname.startsWith('https://')) {
      return pathname;
    }
    // For Vercel Blob, we need to construct the URL or use the pathname directly
    // The blob store URL is typically: https://<store-id>.public.blob.vercel-storage.com/<pathname>
    // Since we might not know the store ID, we should use head() to get the full URL
    // For now, assume pathname could be the full URL from previous operations
    return pathname;
  }

  /**
   * Parse cache-control header to extract max-age value
   */
  private parseCacheControl(cacheControl: string): number {
    const match = cacheControl.match(/max-age=(\d+)/);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }
    // Default to 1 year for immutable
    if (cacheControl.includes('immutable')) {
      return 31536000;
    }
    return 0;
  }
}
