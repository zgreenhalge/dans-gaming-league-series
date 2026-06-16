import { gunzipSync } from 'zlib';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { authOptions } from '@/lib/authOptions';
import { parseDemoFile, type RosterEntry } from '@/lib/demoParser';
import { r2, R2_BUCKET, demoKey } from '@/lib/r2';
import { getAdminClient } from '@/lib/supabase-admin';

export const maxDuration = 300;

const MAX_DEMO_BYTES = 200 * 1024 * 1024; // 200 MB

function decompressIfNeeded(buf: Buffer): Buffer {
  // Gzip magic bytes: 0x1f 0x8b
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    return gunzipSync(buf);
  }
  return buf;
}

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

  // Fetch match, roster, and player details in parallel
  const [{ data: matchRow }, { data: playerRow }, { data: matchStats }] = await Promise.all([
    supabaseAdmin
      .from('matches')
      .select('id, skins_starting_side, weeks(seasons(target_win_rounds))')
      .eq('id', matchId)
      .maybeSingle(),
    supabaseAdmin.from('players').select('is_admin').eq('id', playerId).maybeSingle(),
    supabaseAdmin
      .from('player_match_stats')
      .select('player_id, faction')
      .eq('match_id', matchId),
  ]);

  if (!matchRow) {
    return NextResponse.json({ error: 'Match not found' }, { status: 404 });
  }

  const isAdmin = !!(playerRow as { is_admin?: boolean } | null)?.is_admin;
  const allStats = (matchStats ?? []) as { player_id: number; faction: string }[];
  const isInMatch = allStats.some((s) => s.player_id === playerId);

  if (!isAdmin && !isInMatch) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Supabase returns nested relations as arrays; unwrap safely
  const match = matchRow as {
    id: number;
    skins_starting_side: 'CT' | 'T' | null;
    weeks: unknown;
  };

  const weeksArr = Array.isArray(match.weeks) ? match.weeks : [match.weeks];
  const firstWeek = weeksArr[0] as { seasons: unknown } | undefined;
  const seasonsArr = Array.isArray(firstWeek?.seasons) ? firstWeek!.seasons : [firstWeek?.seasons];
  const firstSeason = seasonsArr[0] as { target_win_rounds?: number } | undefined;
  const targetWinRounds: number = firstSeason?.target_win_rounds ?? 13;

  // Fetch player details (steam_id, name, steam_nickname) for all rostered players
  const playerIds = allStats.map((s) => s.player_id);
  const { data: playerDetails } = await supabaseAdmin
    .from('players')
    .select('id, name, steam_id, steam_nickname')
    .in('id', playerIds);

  const playerMap = new Map(
    ((playerDetails ?? []) as { id: number; name: string; steam_id: string | null; steam_nickname: string | null }[]).map(
      (p) => [p.id, p],
    ),
  );

  const roster: RosterEntry[] = allStats.map((s) => {
    const p = playerMap.get(s.player_id);
    return {
      player_id: s.player_id,
      faction: s.faction as 'SHIRTS' | 'SKINS',
      steam_id: p?.steam_id ?? null,
      name: p?.name ?? `#${s.player_id}`,
      steam_nickname: p?.steam_nickname ?? null,
    };
  });

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
  const demoBuffer = decompressIfNeeded(Buffer.concat(chunks));

  let result;
  try {
    result = parseDemoFile(demoBuffer, roster, match.skins_starting_side, targetWinRounds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 422 });
  }

  return NextResponse.json(result);
}
