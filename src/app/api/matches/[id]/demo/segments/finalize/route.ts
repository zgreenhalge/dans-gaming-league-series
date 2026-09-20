import { NextRequest, NextResponse } from 'next/server';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET, demoSegmentKey, MAX_DEMO_SEGMENTS } from '@/lib/r2';
import { putDemoManifest } from '@/lib/demo/segmentManifest';
import { requireMatchAccess } from '@/lib/match-access';
import { parseMatchId } from '@/lib/util';

async function objectExists(key: string): Promise<boolean> {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** Writes a multi-segment match's demo manifest once every segment is confirmed present in R2 —
 *  the client is expected to call this only after every PUT to a URL from `demo/upload-url`
 *  succeeds, but that's a client-side promise, not something this route can trust on its own, so
 *  every path is HEAD-checked here too before the manifest is written. That keeps "manifest
 *  present ⇒ this match's demo is fully in R2" an invariant the server actually enforces, not one
 *  the client merely intends. A single-file upload never calls this; it uses the canonical
 *  demoKey() with no manifest at all. */
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

  const body = await req.json().catch(() => null);
  const paths = (body as { paths?: unknown } | null)?.paths;
  if (!Array.isArray(paths) || paths.length < 2 || paths.length > MAX_DEMO_SEGMENTS) {
    return NextResponse.json(
      { error: `paths must be an array of 2-${MAX_DEMO_SEGMENTS} segment keys.` },
      { status: 400 },
    );
  }

  // Only accept this match's own deterministic segment keys — never an arbitrary caller-supplied
  // R2 path, since the parse route trusts every key the manifest lists.
  const expected = new Set(Array.from({ length: MAX_DEMO_SEGMENTS }, (_, i) => demoSegmentKey(matchId, i)));
  const uniquePaths = new Set(paths);
  if (uniquePaths.size !== paths.length || [...uniquePaths].some((p) => !expected.has(p as string))) {
    return NextResponse.json({ error: 'paths must be this match\'s own unique segment keys.' }, { status: 400 });
  }

  const existence = await Promise.all((paths as string[]).map(objectExists));
  const missing = (paths as string[]).filter((_, i) => !existence[i]);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Segment(s) not found in R2, upload may be incomplete: ${missing.join(', ')}` },
      { status: 400 },
    );
  }

  await putDemoManifest(matchId, paths as string[]);
  return NextResponse.json({ ok: true });
}
