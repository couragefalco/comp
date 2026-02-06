'use server';

import { storage, STORAGE_BUCKETS, extractPathnameFromUrl } from '@/app/storage';
import { auth } from '@/utils/auth';
import { AttachmentEntityType, db } from '@db';
import { headers } from 'next/headers';
import { z } from 'zod';

const schema = z.object({
  attachmentId: z.string(),
});

export const getTaskAttachmentUrl = async (input: z.infer<typeof schema>) => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  const { attachmentId } = input;
  const organizationId = session?.session?.activeOrganizationId;

  if (!organizationId) {
    return {
      success: false,
      error: 'Not authorized - no organization found',
    } as const;
  }

  try {
    // 1. Find the attachment and verify ownership/type
    const attachment = await db.attachment.findUnique({
      where: {
        id: attachmentId,
        organizationId: organizationId,
        entityType: AttachmentEntityType.task, // Ensure it's a task attachment
      },
    });

    if (!attachment) {
      return {
        success: false,
        error: 'Attachment not found or access denied',
      } as const;
    }

    // 2. Extract pathname from the stored URL
    let pathname: string;
    try {
      pathname = extractPathnameFromUrl(attachment.url);
    } catch (extractError) {
      console.error('Error extracting pathname for attachment:', attachmentId, extractError);
      return {
        success: false,
        error: 'Could not process attachment URL',
      } as const;
    }

    // 3. Generate URL using storage
    try {
      const signedUrl = await storage.getUrl(pathname, {
        expiresIn: 3600, // URL expires in 1 hour
      });

      if (!signedUrl) {
        console.error('getUrl returned undefined for pathname:', pathname);
        return {
          success: false,
          error: 'Failed to generate URL',
        } as const;
      }

      // 4. Return Success
      return { success: true, data: { signedUrl } };
    } catch (storageError) {
      console.error('Storage getUrl Error:', storageError);
      // Provide a generic error message to the client
      return {
        success: false,
        error: 'Could not generate access URL for the file',
      } as const;
    }
  } catch (dbError) {
    // Catch potential DB errors during findUnique
    console.error('Database Error fetching attachment:', dbError);
    return {
      success: false,
      error: 'Failed to retrieve attachment details',
    } as const;
  }
};
