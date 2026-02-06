'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@db';
import { authActionClient } from '../safe-action';
import { storage, STORAGE_BUCKETS } from '@/app/storage';

const deleteVersionSchema = z.object({
  versionId: z.string().min(1, 'Version ID is required'),
  policyId: z.string().min(1, 'Policy ID is required'),
});

async function deletePolicyVersionPdf(key: string): Promise<void> {
  try {
    const pathname = `${STORAGE_BUCKETS.ATTACHMENTS}/${key}`;
    await storage.delete(pathname);
  } catch (error) {
    console.error('Error deleting policy PDF:', error);
  }
}

export const deleteVersionAction = authActionClient
  .inputSchema(deleteVersionSchema)
  .metadata({
    name: 'delete-policy-version',
    track: {
      event: 'delete-policy-version',
      description: 'Delete a policy version',
      channel: 'server',
    },
  })
  .action(async ({ parsedInput, ctx }) => {
    const { versionId, policyId } = parsedInput;
    const { activeOrganizationId } = ctx.session;

    if (!activeOrganizationId) {
      return { success: false, error: 'Not authorized' };
    }

    // Verify policy exists and belongs to organization
    const policy = await db.policy.findUnique({
      where: { id: policyId, organizationId: activeOrganizationId },
      select: {
        id: true,
        currentVersionId: true,
        pendingVersionId: true,
      },
    });

    if (!policy) {
      return { success: false, error: 'Policy not found' };
    }

    // Get version to delete
    const version = await db.policyVersion.findUnique({
      where: { id: versionId },
      select: {
        id: true,
        policyId: true,
        pdfUrl: true,
        version: true,
      },
    });

    if (!version || version.policyId !== policyId) {
      return { success: false, error: 'Version not found' };
    }

    // Cannot delete published version
    if (version.id === policy.currentVersionId) {
      return { success: false, error: 'Cannot delete the published version' };
    }

    // Cannot delete pending version
    if (version.id === policy.pendingVersionId) {
      return { success: false, error: 'Cannot delete a version pending approval' };
    }

    // Delete PDF from S3 if exists
    if (version.pdfUrl) {
      await deletePolicyVersionPdf(version.pdfUrl);
    }

    // Delete version
    await db.policyVersion.delete({
      where: { id: versionId },
    });

    revalidatePath(`/${activeOrganizationId}/policies/${policyId}`);

    return {
      success: true,
      data: { deletedVersion: version.version },
    };
  });
