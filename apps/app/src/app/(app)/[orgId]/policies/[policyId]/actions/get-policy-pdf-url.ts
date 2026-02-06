'use server';

import { authActionClient } from '@/actions/safe-action';
import { storage, STORAGE_BUCKETS } from '@/app/storage';
import { db } from '@db';
import { z } from 'zod';

export const getPolicyPdfUrlAction = authActionClient
  .inputSchema(z.object({
    policyId: z.string(),
    versionId: z.string().optional(), // If provided, get URL for this version's PDF
  }))
  .metadata({
    name: 'get-policy-pdf-url',
    track: {
      event: 'get-policy-pdf-url-s3',
      channel: 'server',
    },
  })
  .action(async ({ parsedInput, ctx }) => {
    const { policyId, versionId } = parsedInput;
    const { session } = ctx;
    const organizationId = session.activeOrganizationId;

    if (!organizationId) {
      return { success: false, error: 'Not authorized' };
    }

    try {
      let pdfUrl: string | null = null;

      if (versionId) {
        // Get PDF URL from specific version
        // IMPORTANT: Include organizationId check to prevent cross-org access
        const version = await db.policyVersion.findUnique({
          where: { id: versionId },
          select: {
            pdfUrl: true,
            policyId: true,
            policy: {
              select: { organizationId: true },
            },
          },
        });

        if (
          !version ||
          version.policyId !== policyId ||
          version.policy.organizationId !== organizationId
        ) {
          return { success: false, error: 'Version not found' };
        }

        pdfUrl = version.pdfUrl;
      } else {
        // Legacy: get from policy level
        const policy = await db.policy.findUnique({
          where: { id: policyId, organizationId },
          select: {
            pdfUrl: true,
            currentVersion: {
              select: { pdfUrl: true },
            },
          },
        });

        pdfUrl = policy?.currentVersion?.pdfUrl ?? policy?.pdfUrl ?? null;
      }

      if (!pdfUrl) {
        return { success: false, error: 'No PDF found.' };
      }

      // Generate a temporary, secure URL for the client to render the PDF from storage
      const pathname = `${STORAGE_BUCKETS.ATTACHMENTS}/${pdfUrl}`;
      const signedUrl = await storage.getUrl(pathname, { expiresIn: 900 }); // URL is valid for 15 minutes

      return { success: true, data: signedUrl };
    } catch (error) {
      console.error('Error generating URL for policy PDF:', error);
      return { success: false, error: 'Could not retrieve PDF.' };
    }
  });
