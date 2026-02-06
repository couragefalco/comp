'use server';

import { authActionClient } from '@/actions/safe-action';
import { storage, STORAGE_BUCKETS } from '@/app/storage';
import { db, PolicyDisplayFormat } from '@db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const uploadPolicyPdfSchema = z.object({
  policyId: z.string(),
  versionId: z.string().optional(), // If provided, upload to this version
  fileName: z.string(),
  fileType: z.string(),
  fileData: z.string(), // Base64 encoded file content
});

export const uploadPolicyPdfAction = authActionClient
  .inputSchema(uploadPolicyPdfSchema)
  .metadata({
    name: 'upload-policy-pdf',
    track: {
      event: 'upload-policy-pdf-s3',
      channel: 'server',
    },
  })
  .action(async ({ parsedInput, ctx }) => {
    const { policyId, versionId, fileName, fileType, fileData } = parsedInput;
    const { session } = ctx;
    const organizationId = session.activeOrganizationId;

    if (!organizationId) {
      return { success: false, error: 'Not authorized' };
    }

    try {
      // Verify policy belongs to organization
      const policy = await db.policy.findUnique({
        where: { id: policyId, organizationId },
        select: {
          id: true,
          pdfUrl: true,
          currentVersionId: true,
          pendingVersionId: true,
        },
      });

      if (!policy) {
        return { success: false, error: 'Policy not found' };
      }

      let oldPdfUrl: string | null = null;

      if (versionId) {
        // Upload to specific version
        const version = await db.policyVersion.findUnique({
          where: { id: versionId },
          select: { id: true, policyId: true, pdfUrl: true, version: true },
        });

        if (!version || version.policyId !== policyId) {
          return { success: false, error: 'Version not found' };
        }

        // Don't allow uploading PDF to published or pending versions
        if (version.id === policy.currentVersionId) {
          return { success: false, error: 'Cannot upload PDF to the published version' };
        }
        if (version.id === policy.pendingVersionId) {
          return { success: false, error: 'Cannot upload PDF to a version pending approval' };
        }

        oldPdfUrl = version.pdfUrl;

        const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
        const key = `${organizationId}/policies/${policyId}/v${version.version}-${Date.now()}-${sanitizedFileName}`;
        const pathname = `${STORAGE_BUCKETS.ATTACHMENTS}/${key}`;

        // Upload to storage
        const fileBuffer = Buffer.from(fileData, 'base64');
        await storage.upload(pathname, fileBuffer, {
          contentType: fileType,
        });

        // Update version
        await db.policyVersion.update({
          where: { id: versionId },
          data: { pdfUrl: key },
        });

        // Delete old PDF if it exists and is different
        if (oldPdfUrl && oldPdfUrl !== key) {
          try {
            await storage.delete(`${STORAGE_BUCKETS.ATTACHMENTS}/${oldPdfUrl}`);
          } catch (error) {
            console.error('Error cleaning up old version PDF from storage:', error);
          }
        }

        revalidatePath(`/${organizationId}/policies/${policyId}`);
        return { success: true, data: { s3Key: key } };
      }

      // Legacy: upload to policy level
      oldPdfUrl = policy.pdfUrl;
      const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
      const key = `${organizationId}/policies/${policyId}/${Date.now()}-${sanitizedFileName}`;
      const pathname = `${STORAGE_BUCKETS.ATTACHMENTS}/${key}`;

      const fileBuffer = Buffer.from(fileData, 'base64');
      await storage.upload(pathname, fileBuffer, {
        contentType: fileType,
      });

      await db.policy.update({
        where: { id: policyId, organizationId },
        data: {
          pdfUrl: key,
          displayFormat: PolicyDisplayFormat.PDF,
        },
      });

      if (oldPdfUrl && oldPdfUrl !== key) {
        try {
          await storage.delete(`${STORAGE_BUCKETS.ATTACHMENTS}/${oldPdfUrl}`);
        } catch (error) {
          console.error('Error cleaning up old policy PDF from storage:', error);
        }
      }

      revalidatePath(`/${organizationId}/policies/${policyId}`);
      return { success: true, data: { s3Key: key } };
    } catch (error) {
      console.error('Error uploading policy PDF to storage:', error);
      return { success: false, error: 'Failed to upload PDF.' };
    }
  });
