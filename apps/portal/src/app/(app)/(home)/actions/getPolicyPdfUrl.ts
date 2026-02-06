'use server';

import { authActionClient } from '@/actions/safe-action';
import { storage, STORAGE_BUCKETS } from '@/utils/storage';
import { db } from '@db';
import { z } from 'zod';

export const getPolicyPdfUrl = authActionClient
  .inputSchema(
    z.object({
      policyId: z.string(),
      versionId: z.string().optional(), // If provided, get URL for this version's PDF
    }),
  )
  .metadata({
    name: 'getPolicyPdfUrl',
    track: {
      event: 'portal-get-policy-pdf-url',
      channel: 'server',
    },
  })
  .action(async ({ parsedInput, ctx }) => {
    const { policyId, versionId } = parsedInput;
    const { user } = ctx;

    if (!user) {
      throw new Error('Unauthorized');
    }

    try {
      // Get policy with currentVersion to find the right pdfUrl
      const policy = await db.policy.findUnique({
        where: { id: policyId, status: 'published' },
        select: {
          pdfUrl: true,
          organizationId: true,
          currentVersion: {
            select: { id: true, pdfUrl: true },
          },
        },
      });

      if (!policy) {
        return { success: false, error: 'Policy not found.' };
      }

      const member = await db.member.findFirst({
        where: { userId: user.id, organizationId: policy.organizationId, deactivated: false },
      });

      if (!member) {
        return { success: false, error: 'Access denied.' };
      }

      // Determine which pdfUrl to use:
      // 1. If versionId provided, try to get that version's pdfUrl
      // 2. Otherwise use currentVersion's pdfUrl
      // 3. Fallback to policy-level pdfUrl for backward compatibility
      let pdfUrl: string | null = null;

      if (versionId) {
        const version = await db.policyVersion.findUnique({
          where: { id: versionId },
          select: { pdfUrl: true },
        });
        pdfUrl = version?.pdfUrl ?? null;
      } else if (policy.currentVersion?.pdfUrl) {
        pdfUrl = policy.currentVersion.pdfUrl;
      } else {
        pdfUrl = policy.pdfUrl;
      }

      if (!pdfUrl) {
        return { success: false, error: 'No PDF found for this policy.' };
      }

      const pathname = `${STORAGE_BUCKETS.ATTACHMENTS}/${pdfUrl}`;
      const signedUrl = await storage.getUrl(pathname, { expiresIn: 900 });

      return { success: true, data: signedUrl };
    } catch (error) {
      console.error('Error generating signed URL for portal:', error);
      return { success: false, error: 'Could not retrieve PDF.' };
    }
  });
