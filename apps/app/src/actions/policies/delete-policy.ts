'use server';

import { storage, STORAGE_BUCKETS } from '@/app/storage';
import { db } from '@db';
import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';
import { authActionClient } from '../safe-action';

const deletePolicySchema = z.object({
  id: z.string(),
  entityId: z.string(),
});

export const deletePolicyAction = authActionClient
  .inputSchema(deletePolicySchema)
  .metadata({
    name: 'delete-policy',
    track: {
      event: 'delete-policy',
      description: 'Delete Policy',
      channel: 'server',
    },
  })
  .action(async ({ parsedInput, ctx }) => {
    const { id } = parsedInput;
    const { activeOrganizationId } = ctx.session;

    if (!activeOrganizationId) {
      return {
        success: false,
        error: 'Not authorized',
      };
    }

    try {
      const policy = await db.policy.findUnique({
        where: {
          id,
          organizationId: activeOrganizationId,
        },
        include: {
          versions: {
            select: { pdfUrl: true },
          },
        },
      });

      if (!policy) {
        return {
          success: false,
          error: 'Policy not found',
        };
      }

      // Clean up storage files before cascade delete
      const pdfUrlsToDelete: string[] = [];

      // Add policy-level PDF if exists
      if (policy.pdfUrl) {
        pdfUrlsToDelete.push(`${STORAGE_BUCKETS.ATTACHMENTS}/${policy.pdfUrl}`);
      }

      // Add all version PDFs
      for (const version of policy.versions) {
        if (version.pdfUrl) {
          pdfUrlsToDelete.push(`${STORAGE_BUCKETS.ATTACHMENTS}/${version.pdfUrl}`);
        }
      }

      // Delete all PDFs from storage
      if (pdfUrlsToDelete.length > 0) {
        await storage.deleteMany(pdfUrlsToDelete);
      }

      // Delete the policy (versions are cascade deleted)
      await db.policy.delete({
        where: { id },
      });

      // Revalidate paths to update UI
      revalidatePath(`/${activeOrganizationId}/policies`);
      revalidateTag('policies', 'max');

      return { success: true };
    } catch (error) {
      console.error(error);
      return {
        success: false,
        error: 'Failed to delete policy',
      };
    }
  });
