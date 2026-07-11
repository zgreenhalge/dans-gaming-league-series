import { after } from 'next/server';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { isPlayedScore, parseMatchId } from '@/lib/util';
import { getAdminClient } from '@/lib/supabase-admin';
import { teardownMatchServer } from '@/lib/dathost-lifecycle';
import { recordOpsError, clearOpsError } from '@/lib/ops-errors';
import { writeMatchScore } from '@/lib/matchScore';
import type { DemoSabremetricStat } from '@/lib/types';

const supabaseAdmin = getAdminClient();

type MatchRow = {
  id: number;
  final_score: string | null;
  is_playoff_game: boolean;
  shirts_ban: string | null;
  shirts_ban2: string | null;
  skins_ban1: string | null;
  skins_ban2: string | null;
  shirts_pick: string | null;
  skins_starting_side: string | null;
  weeks: {
    season_id: number;
    seasons: {
      is_gauntlet: boolean;
    };
  };
};

function isVetoComplete(match: MatchRow): boolean {
  const isGauntlet = match.weeks?.seasons?.is_gauntlet ?? false;
  const isPlayoff = match.is_playoff_game && !isGauntlet;

  if (isGauntlet || isPlayoff) {
    // 4 bans required; map is auto-picked
    return !!(match.shirts_ban && match.shirts_ban2 && match.skins_ban1 && match.skins_ban2);
  }
  // Regular: 5 steps
  return !!(
    match.shirts_ban &&
    match.skins_ban1 &&
    match.skins_ban2 &&
    match.shirts_pick &&
    match.skins_starting_side
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const matchId = parseMatchId(id);
  if (matchId === null) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }

  const playerId = session.user.playerId;

  const [{ data: matchRow }, { data: playerRow }, { data: matchStats }] = await Promise.all([
    supabaseAdmin
      .from('matches')
      .select(
        'id, final_score, is_playoff_game, shirts_ban, shirts_ban2, skins_ban1, skins_ban2, shirts_pick, skins_starting_side, weeks(season_id, seasons(is_gauntlet))',
      )
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

  const m = matchRow as unknown as MatchRow;
  const isAdmin = !!(playerRow as { is_admin?: boolean } | null)?.is_admin;
  const allStats = (matchStats ?? []) as { player_id: number; faction: string }[];
  const isInMatch = allStats.some((s) => s.player_id === playerId);

  if (!isAdmin && !isInMatch) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const alreadyPlayed = isPlayedScore(m.final_score);

  // Non-admins cannot edit once a score is recorded
  if (alreadyPlayed && !isAdmin) {
    return NextResponse.json({ error: 'Only admins can edit a submitted result' }, { status: 403 });
  }

  if (!isVetoComplete(m)) {
    return NextResponse.json({ error: 'Pick/ban phase not complete' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { shirts, skins, player_stats, sabremetrics, round_history, warnings } = body as {
    shirts: unknown;
    skins: unknown;
    player_stats: unknown;
    sabremetrics?: DemoSabremetricStat[];
    round_history?: unknown;
    warnings?: unknown; // parser warnings forwarded from the confirm — used to learn steam ids
  };

  const result = await writeMatchScore(
    supabaseAdmin,
    matchId,
    {
      shirts,
      skins,
      player_stats,
      sabremetrics,
      round_history,
      warnings: Array.isArray(warnings) ? (warnings as string[]) : undefined,
    },
    { learnSteamIds: isAdmin, after },
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Score reported → tear down the match server (reuse model = stop, never delete). Best-effort;
  // skipped when hosting isn't configured. `onlyIfOwnsServer` ensures editing one match's score
  // never stops another match's live server on the shared host.
  if (process.env.DATHOST_SERVER_ID) {
    after(async () => {
      try {
        await teardownMatchServer(supabaseAdmin, matchId, { onlyIfOwnsServer: true });
        await clearOpsError(supabaseAdmin, 'match', matchId, 'server_teardown');
      } catch (err) {
        console.error(`auto-teardown(${matchId}) failed:`, err);
        await recordOpsError(supabaseAdmin, 'match', matchId, 'server_teardown', `Server teardown failed: ${(err as Error).message}`);
      }
    });
  }

  return NextResponse.json({ ok: true });
}
