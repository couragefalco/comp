import { auth } from '@/app/lib/auth';
import { validateMemberAndOrg } from '@/app/api/download-agent/utils';
import { storage, STORAGE_BUCKETS } from '@/utils/storage';
import { db } from '@db';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const organizationId = req.nextUrl.searchParams.get('organizationId');

  if (!organizationId) {
    return NextResponse.json({ error: 'No organization ID' }, { status: 400 });
  }

  const session = await auth.api.getSession({ headers: req.headers });

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const member = await validateMemberAndOrg(session.user.id, organizationId);
  if (!member) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const results = await db.fleetPolicyResult.findMany({
    where: { organizationId, userId: session.user.id },
    orderBy: { createdAt: 'desc' },
  });

  const withSignedUrls = await Promise.all(
    results.map(async (result) => {
      const signedAttachments = await Promise.all(
        result.attachments.map(async (key) => {
          try {
            const pathname = `${STORAGE_BUCKETS.ORG_ASSETS}/${key}`;
            return await storage.getUrl(pathname, { expiresIn: 3600 });
          } catch {
            return key;
          }
        }),
      );

      return {
        ...result,
        attachments: signedAttachments,
      };
    }),
  );

  return NextResponse.json({ success: true, data: withSignedUrls });
}
