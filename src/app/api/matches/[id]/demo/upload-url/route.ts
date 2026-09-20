import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { r2, R2_BUCKET, demoKey, demoSegmentKey, demoManifestKey, deleteR2Object, MAX_DEMO_SEGMENTS } from '@/lib/r2';
import { requireMatchAccess } from '@/lib/match-access';
import { parseMatchId } from '@/lib/util';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const matchId = parseMatchId(id);
  if (matchId === null) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }

  const access = await requireMatchAccess(matchId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const body = await req.json().catch(() => ({}));
  const rawCount = (body as { count?: unknown }).count;
  const count = rawCount === undefined ? 1 : Number(rawCount);
  if (!Number.isInteger(count) || count < 1 || count > MAX_DEMO_SEGMENTS) {
    return NextResponse.json({ error: `count must be an integer between 1 and ${MAX_DEMO_SEGMENTS}.` }, { status: 400 });
  }

  // A single file keeps using the canonical demoKey() unchanged — every other reader (replay,
  // retention, the parse route's fallback) assumes that key for the normal one-demo case. More
  // than one file uses per-segment keys instead; the parse route combines them once a manifest
  // naming all of them has actually been written (see demo/segments/finalize).
  //
  // A single-file (re-)upload also clears any manifest a previous multi-segment upload for this
  // match left behind — otherwise the parse route would keep combining the old, now-superseded
  // segments instead of reading the freshly-uploaded file, since it checks for a manifest first.
  if (count === 1) {
    await deleteR2Object(demoManifestKey(matchId));
  }
  const keys = count === 1 ? [demoKey(matchId)] : Array.from({ length: count }, (_, i) => demoSegmentKey(matchId, i));

  const uploads = await Promise.all(
    keys.map(async (key) => ({
      signedUrl: await getSignedUrl(
        r2,
        new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: 'application/octet-stream' }),
        { expiresIn: 3600 },
      ),
      path: key,
    })),
  );

  return NextResponse.json({ uploads });
}
