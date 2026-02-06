/**
 * Validates that a pathname is safe and doesn't contain path traversal
 */
export function validatePathname(pathname: string): void {
  if (!pathname || typeof pathname !== 'string') {
    throw new Error('Invalid pathname: must be a non-empty string');
  }

  // Security: Check for path traversal
  if (pathname.includes('../') || pathname.includes('..\\')) {
    throw new Error('Invalid pathname: path traversal detected');
  }

  // Check for null bytes
  if (pathname.includes('\0')) {
    throw new Error('Invalid pathname: null byte detected');
  }
}

/**
 * Extracts a storage key/pathname from either a full URL or a plain key
 * This replaces the S3-specific extractS3KeyFromUrl function
 * @throws {Error} If the input is invalid or potentially malicious
 */
export function extractPathnameFromUrl(url: string): string {
  if (!url || typeof url !== 'string') {
    throw new Error('Invalid input: URL must be a non-empty string');
  }

  // Try to parse as URL
  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(url);
  } catch {
    // Not a valid URL - will handle as pathname below
  }

  if (parsedUrl) {
    // Validate it's a Vercel Blob URL or S3 URL (for backwards compatibility during migration)
    if (!isValidStorageHost(parsedUrl.host)) {
      throw new Error('Invalid URL: Not a valid storage endpoint');
    }

    // Extract and validate the pathname
    const pathname = decodeURIComponent(parsedUrl.pathname.substring(1));

    // Security: Check for path traversal
    validatePathname(pathname);

    return pathname;
  }

  // Not a URL - treat as pathname
  // Security: Ensure it's not a malformed URL attempting to bypass validation
  const lowerInput = url.toLowerCase();
  if (lowerInput.includes('://')) {
    throw new Error('Invalid input: Malformed URL detected');
  }

  // Check for domain-like patterns
  const domainPattern =
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}(\/|$)/i;
  if (domainPattern.test(url)) {
    throw new Error('Invalid input: Domain-like pattern detected in pathname');
  }

  // Security: Check for path traversal
  validatePathname(url);

  // Remove leading slash if present
  const pathname = url.startsWith('/') ? url.substring(1) : url;

  if (!pathname) {
    throw new Error('Invalid pathname: cannot be empty');
  }

  return pathname;
}

/**
 * Validates if a hostname is a valid storage endpoint
 */
function isValidStorageHost(host: string): boolean {
  const normalizedHost = host.toLowerCase();

  // Vercel Blob URLs
  if (
    normalizedHost.endsWith('.blob.vercel-storage.com') ||
    normalizedHost.endsWith('.vercel-storage.com')
  ) {
    return true;
  }

  // AWS S3 URLs (for backwards compatibility during migration)
  if (normalizedHost.endsWith('.amazonaws.com')) {
    return /^([\w.-]+\.)?(s3|s3-[\w-]+|s3-website[\w.-]+|s3-accesspoint|s3-control)(\.[\w-]+)?\.amazonaws\.com$/.test(
      normalizedHost
    );
  }

  return false;
}

/**
 * Generate a unique filename with timestamp and random suffix
 */
export function generateUniqueFilename(originalName: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const ext = originalName.includes('.') ? `.${originalName.split('.').pop()}` : '';
  const baseName = originalName.includes('.')
    ? originalName.substring(0, originalName.lastIndexOf('.'))
    : originalName;

  // Sanitize the base name
  const sanitized = baseName
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 100);

  return `${sanitized}-${timestamp}-${random}${ext}`;
}

/**
 * Get content type from filename extension
 */
export function getContentTypeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();

  const mimeTypes: Record<string, string> = {
    // Documents
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
    txt: 'text/plain',

    // Images
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',

    // Archives
    zip: 'application/zip',
    tar: 'application/x-tar',
    gz: 'application/gzip',

    // Installers
    dmg: 'application/x-apple-diskimage',
    exe: 'application/x-msdownload',
    msi: 'application/x-msi',

    // Other
    json: 'application/json',
    xml: 'application/xml',
    html: 'text/html',
  };

  return mimeTypes[ext || ''] || 'application/octet-stream';
}

/**
 * Convert a base64 string to a Buffer
 */
export function base64ToBuffer(base64: string): Buffer {
  // Handle data URLs (e.g., "data:image/png;base64,...")
  const base64Data = base64.includes(',') ? base64.split(',')[1] ?? base64 : base64;
  return Buffer.from(base64Data, 'base64');
}

/**
 * Convert a Buffer to a base64 string
 */
export function bufferToBase64(buffer: Buffer): string {
  return buffer.toString('base64');
}

/**
 * Build a storage path for organization-scoped files
 */
export function buildOrgPath(orgId: string, ...parts: string[]): string {
  const cleanParts = parts.map((p) => p.replace(/^\/+|\/+$/g, ''));
  return `${orgId}/${cleanParts.join('/')}`;
}

/**
 * Parse a storage URL to extract organization ID and path parts
 */
export function parseOrgPath(pathname: string): { orgId: string; path: string } | null {
  const cleanPath = pathname.startsWith('/') ? pathname.substring(1) : pathname;
  const parts = cleanPath.split('/');

  if (parts.length < 2 || !parts[0]) {
    return null;
  }

  return {
    orgId: parts[0],
    path: parts.slice(1).join('/'),
  };
}
