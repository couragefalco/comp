import { auth } from '@/utils/auth';
import { storage, STORAGE_BUCKETS } from '@/app/storage';
import { db } from '@db';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organizationId = req.nextUrl.searchParams.get('organizationId');
  if (!organizationId) {
    return NextResponse.json({ error: 'No active organization' }, { status: 400 });
  }

  const member = await db.member.findFirst({
    where: {
      userId: session.user.id,
      organizationId,
      deactivated: false,
    },
    select: { id: true },
  });

  if (!member) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const key = req.nextUrl.searchParams.get('key');

  if (!key) {
    return NextResponse.json({ error: 'Missing key' }, { status: 400 });
  }

  // Enforce that the requested key belongs to the caller's organization
  const orgPrefix = `${organizationId}/`;
  if (!key.startsWith(orgPrefix)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const pathname = `${STORAGE_BUCKETS.ORG_ASSETS}/${key}`;
    const url = await storage.getUrl(pathname, { expiresIn: 3600 });

    return NextResponse.json({ url });
  } catch (error) {
    console.error('Failed to generate URL', error);
    return NextResponse.json({ error: 'Failed to generate URL' }, { status: 500 });
  }
}
