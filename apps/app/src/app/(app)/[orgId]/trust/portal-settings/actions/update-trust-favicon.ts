'use server';

import { authActionClient } from '@/actions/safe-action';
import { storage, STORAGE_BUCKETS } from '@/app/storage';
import { db } from '@db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const updateFaviconSchema = z.object({
  fileName: z.string(),
  fileType: z.string(),
  fileData: z.string(), // base64 encoded
});

/**
 * Update trust portal favicon
 * Best practices:
 * - Formats: .ico, .png, .svg
 * - Recommended sizes: 16x16, 32x32, 180x180
 * - Max size: 100KB (favicons should be small)
 */
export const updateTrustFaviconAction = authActionClient
  .inputSchema(updateFaviconSchema)
  .metadata({
    name: 'update-trust-favicon',
    track: {
      event: 'update-trust-favicon',
      channel: 'server',
    },
  })
  .action(async ({ parsedInput, ctx }) => {
    const { fileName, fileType, fileData } = parsedInput;
    const organizationId = ctx.session.activeOrganizationId;

    if (!organizationId) {
      throw new Error('No active organization');
    }

    // Validate file type - favicons can be ico, png, or svg
    const allowedTypes = ['image/x-icon', 'image/vnd.microsoft.icon', 'image/png', 'image/svg+xml'];
    const allowedExtensions = ['.ico', '.png', '.svg'];
    const fileExtension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));

    if (!allowedTypes.includes(fileType) && !allowedExtensions.includes(fileExtension)) {
      throw new Error('Favicon must be .ico, .png, or .svg format');
    }

    // Convert base64 to buffer
    const fileBuffer = Buffer.from(fileData, 'base64');

    // Validate file size (100KB limit for favicons - they should be small)
    const MAX_FILE_SIZE_BYTES = 100 * 1024; // 100KB
    if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
      throw new Error('Favicon must be less than 100KB');
    }

    // Generate storage pathname
    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const pathname = `${STORAGE_BUCKETS.ORG_ASSETS}/${organizationId}/trust/favicon/${timestamp}-${sanitizedFileName}`;

    // Upload to storage
    await storage.upload(pathname, fileBuffer, {
      contentType: fileType,
      cacheControl: 'public, max-age=31536000, immutable', // Cache favicons for 1 year
    });

    // Get existing trust record
    const trust = await db.trust.findUnique({
      where: { organizationId },
    });

    if (!trust) {
      throw new Error('Trust portal not found');
    }

    // Update trust with new favicon key
    await db.trust.update({
      where: { organizationId },
      data: { favicon: pathname },
    });

    // Generate URL for immediate display
    const signedUrl = await storage.getUrl(pathname, {
      expiresIn: 3600,
    });

    revalidatePath(`/${organizationId}/trust/portal-settings`);

    return { success: true, faviconUrl: signedUrl };
  });

export const removeTrustFaviconAction = authActionClient
  .inputSchema(z.object({}))
  .metadata({
    name: 'remove-trust-favicon',
    track: {
      event: 'remove-trust-favicon',
      channel: 'server',
    },
  })
  .action(async ({ ctx }) => {
    const organizationId = ctx.session.activeOrganizationId;

    if (!organizationId) {
      throw new Error('No active organization');
    }

    // Remove favicon from trust
    await db.trust.update({
      where: { organizationId },
      data: { favicon: null },
    });

    revalidatePath(`/${organizationId}/trust/portal-settings`);

    return { success: true };
  });
