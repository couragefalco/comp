'use server';

import { authActionClient } from '@/actions/safe-action';
import { storage, STORAGE_BUCKETS } from '@/app/storage';
import { db } from '@db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const updateLogoSchema = z.object({
  fileName: z.string(),
  fileType: z.string(),
  fileData: z.string(), // base64 encoded
});

export const updateOrganizationLogoAction = authActionClient
  .inputSchema(updateLogoSchema)
  .metadata({
    name: 'update-organization-logo',
    track: {
      event: 'update-organization-logo',
      channel: 'server',
    },
  })
  .action(async ({ parsedInput, ctx }) => {
    const { fileName, fileType, fileData } = parsedInput;
    const organizationId = ctx.session.activeOrganizationId;

    if (!organizationId) {
      throw new Error('No active organization');
    }

    // Validate file type
    if (!fileType.startsWith('image/')) {
      throw new Error('Only image files are allowed');
    }

    // Convert base64 to buffer
    const fileBuffer = Buffer.from(fileData, 'base64');

    // Validate file size (2MB limit for logos)
    const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
    if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
      throw new Error('Logo must be less than 2MB');
    }

    // Generate storage pathname
    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const pathname = `${STORAGE_BUCKETS.ORG_ASSETS}/${organizationId}/logo/${timestamp}-${sanitizedFileName}`;

    // Upload to storage
    await storage.upload(pathname, fileBuffer, {
      contentType: fileType,
    });

    // Update organization with new logo key
    await db.organization.update({
      where: { id: organizationId },
      data: { logo: pathname },
    });

    // Generate URL for immediate display
    const signedUrl = await storage.getUrl(pathname, {
      expiresIn: 3600,
    });

    revalidatePath(`/${organizationId}/settings`);

    return { success: true, logoUrl: signedUrl };
  });

export const removeOrganizationLogoAction = authActionClient
  .inputSchema(z.object({}))
  .metadata({
    name: 'remove-organization-logo',
    track: {
      event: 'remove-organization-logo',
      channel: 'server',
    },
  })
  .action(async ({ ctx }) => {
    const organizationId = ctx.session.activeOrganizationId;

    if (!organizationId) {
      throw new Error('No active organization');
    }

    // Remove logo from organization
    await db.organization.update({
      where: { id: organizationId },
      data: { logo: null },
    });

    revalidatePath(`/${organizationId}/settings`);

    return { success: true };
  });
