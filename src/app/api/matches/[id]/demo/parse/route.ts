import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { authOptions } from '@/lib/authOptions';
import { parseDemoFile } from '@/lib/demoParser';
import { parseDemoSabremetrics } from '@/lib/demoOrchestrator';
import { getReplayInputs } from '@/lib/replay/inputs';
import { r2, R2_BUCKET, demoKey } from '@/lib/r2';
import { getAdminClient } from '@/lib/supabase-admin';
import { gunzipMaybe } from '@/lib/gzip';

export const maxDuration = 300;

const MAX_DEMO_BYTES = 200 * 1024 * 1024; // 200 MB

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const matchId = Number(id);
  if (!Number.isFinite(matchId)) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }

  const playerId = session.user.playerId;
  const supabaseAdmin = getAdminClient();

  const { data: playerRow } = await supabaseAdmin
    .from('players')
    .select('is_admin')
    .eq('id', playerId)
    .maybeSingle();

  // Roster/sides/target-rounds via the shared resolver (one source of roster truth,
  // also used by the replay pipeline — see src/lib/replay/inputs.ts).
  let inputs;
  try {
    inputs = await getReplayInputs(supabaseAdmin, matchId);
  } catch {
    return NextResponse.json({ error: 'Match not found' }, { status: 404 });
  }

  const isAdmin = !!(playerRow as { is_admin?: boolean } | null)?.is_admin;
  const isInMatch = inputs.roster.some((r) => r.player_id === playerId);
  if (!isAdmin && !isInMatch) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Download demo from R2
  const key = demoKey(matchId);
  const r2Res = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  if (!r2Res.Body) {
    return NextResponse.json(
      { error: 'Demo file not found. Upload a demo file first.' },
      { status: 404 },
    );
  }
  const contentLength = r2Res.ContentLength ?? 0;
  if (contentLength > MAX_DEMO_BYTES) {
    return NextResponse.json(
      { error: `Demo file is too large (${Math.round(contentLength / 1024 / 1024)} MB). Maximum is ${MAX_DEMO_BYTES / 1024 / 1024} MB.` },
      { status: 413 },
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of r2Res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  const demoBuffer = gunzipMaybe(Buffer.concat(chunks));

  let result, sabremetricsResult;
  try {
    result = parseDemoFile(demoBuffer, inputs.roster, inputs.skinsSide, inputs.targetWinRounds);
    sabremetricsResult = parseDemoSabremetrics(demoBuffer, inputs.roster, inputs.skinsSide, inputs.targetWinRounds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 422 });
  }

  return NextResponse.json({
    ...result,
    sabremetrics: sabremetricsResult.sabremetrics,
    warnings: [...new Set([...result.warnings, ...sabremetricsResult.warnings])],
  });
}
