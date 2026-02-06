'use server';

import { storage, STORAGE_BUCKETS, extractPathnameFromUrl } from '@/app/storage';
import { auth } from '@/utils/auth';
import { Attachment, AttachmentEntityType, db } from '@db';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';

const schema = z.object({
  attachmentId: z.string(),
});

export const deleteTaskAttachment = async (input: z.infer<typeof schema>) => {
  const { attachmentId } = input;
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  const organizationId = session?.session?.activeOrganizationId;

  if (!organizationId) {
    return { success: false, error: 'Not authorized' } as const;
  }

  let attachmentToDelete: Attachment | null = null;
  try {
    // 1. Find the attachment record and verify ownership/type
    attachmentToDelete = await db.attachment.findUnique({
      where: {
        id: attachmentId,
        organizationId: organizationId,
        entityType: AttachmentEntityType.task,
      },
    });

    if (!attachmentToDelete) {
      return {
        success: false,
        error: 'Attachment not found or access denied',
      } as const;
    }

    // 2. Attempt to delete from storage
    try {
      const pathname = extractPathnameFromUrl(attachmentToDelete.url);
      await storage.delete(pathname);
    } catch (storageError: unknown) {
      const errorMessage = storageError instanceof Error ? storageError.message : String(storageError);
      console.error('Storage Delete Error for attachment:', attachmentId, errorMessage);
    }

    // 3. Delete from Database
    await db.attachment.delete({
      where: {
        id: attachmentId,
        organizationId: organizationId,
      },
    });

    // Revalidate the task path if needed, depends on how attachments are loaded
    revalidatePath(`/${organizationId}/tasks/${attachmentToDelete.entityId}`);

    return {
      success: true,
      data: { deletedAttachmentId: attachmentId },
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error deleting attachment:', attachmentId, errorMessage);
    return {
      success: false,
      error: 'Failed to delete attachment.',
    } as const;
  }
};
