import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { parseDemoFile, parseDemoFileSegments } from '@/lib/demoParser';
import { parseDemoSabremetrics, parseDemoSabremetricsSegments } from '@/lib/demoSabremetrics';
import { getReplayInputs } from '@/lib/replay/inputs';
import { r2, R2_BUCKET, demoKey } from '@/lib/r2';
import { getDemoManifest } from '@/lib/demo/segmentManifest';
import { getAdminClient } from '@/lib/supabase-admin';
import { gunzipMaybe } from '@/lib/gzip';
import { clearLiveScoreBestEffort } from '@/lib/demo/liveScore';

export const maxDuration = 300;

const MAX_DEMO_BYTES = 200 * 1024 * 1024; // 200 MB per segment

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
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

  // A manifest means this match's demo was uploaded as multiple segments (see
  // docs/demo-ingestion.md's "Multi-segment demos") — its keys are read instead of the canonical
  // single-file demoKey(). Absent, this is a normal one-demo match, unchanged from before.
  const manifest = await getDemoManifest(matchId);
  const keys = manifest ? manifest.segments : [demoKey(matchId)];

  const demoBuffers: Buffer[] = [];
  let clearedLiveScore = false;
  for (const key of keys) {
    const r2Res = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key })).catch(() => null);
    if (!r2Res?.Body) {
      return NextResponse.json(
        {
          error: manifest
            ? `Demo segment not found (${key}) — the upload may be incomplete.`
            : 'Demo file not found. Upload a demo file first.',
        },
        { status: 404 },
      );
    }
    // A demo landing in R2 is proof the match is over, whether or not it goes on to parse cleanly
    // (a manual upload can be a partial/corrupt recording salvaged after a server issue) — clear the
    // live-match ticker as soon as we've confirmed the first read succeeded, before either parser
    // runs, matching pullDemoAndClearLiveScore's "presence in R2 ends 'live'" rule for the automated
    // pull path.
    if (!clearedLiveScore) {
      await clearLiveScoreBestEffort(supabaseAdmin, matchId);
      clearedLiveScore = true;
    }
    const contentLength = r2Res.ContentLength ?? 0;
    if (contentLength > MAX_DEMO_BYTES) {
      return NextResponse.json(
        { error: `Demo file ${key} is too large (${Math.round(contentLength / 1024 / 1024)} MB). Maximum is ${MAX_DEMO_BYTES / 1024 / 1024} MB.` },
        { status: 413 },
      );
    }
    const chunks: Buffer[] = [];
    for await (const chunk of r2Res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    demoBuffers.push(gunzipMaybe(Buffer.concat(chunks)));
  }

  let result, sabremetricsResult;
  try {
    result = demoBuffers.length > 1
      ? parseDemoFileSegments(demoBuffers, inputs.roster, inputs.skinsSide, inputs.targetWinRounds)
      : parseDemoFile(demoBuffers[0], inputs.roster, inputs.skinsSide, inputs.targetWinRounds);
    sabremetricsResult = demoBuffers.length > 1
      ? parseDemoSabremetricsSegments(demoBuffers, inputs.roster, inputs.skinsSide, inputs.targetWinRounds)
      : parseDemoSabremetrics(demoBuffers[0], inputs.roster, inputs.skinsSide, inputs.targetWinRounds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 422 });
  }

  return NextResponse.json({
    ...result,
    sabremetrics: sabremetricsResult.sabremetrics,
    weaponStats: sabremetricsResult.weaponStats,
    matchKills: sabremetricsResult.matchKills,
    matchRounds: sabremetricsResult.matchRounds,
    matchUtilityThrows: sabremetricsResult.matchUtilityThrows,
    matchRoundEconomy: sabremetricsResult.matchRoundEconomy,
    matchDamageEvents: sabremetricsResult.matchDamageEvents,
    warnings: [...new Set([...result.warnings, ...sabremetricsResult.warnings])],
  });
}
