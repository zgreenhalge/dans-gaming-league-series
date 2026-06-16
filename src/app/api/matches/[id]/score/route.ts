import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { isPlayedScore } from '@/lib/util';
import { getAdminClient } from '@/lib/supabase-admin';

const supabaseAdmin = getAdminClient();

type PlayerStatInput = {
  player_id: number;
  kills: number;
  assists: number;
  deaths: number;
  damage: number;
  adr?: number | null;
};

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
  const matchId = Number(id);
  if (!Number.isFinite(matchId)) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }

  const playerId = session.user.playerId;

  const [{ data: matchRow }, { data: playerRow }, { data: matchStats }] = await Promise.all([
    supabaseAdmin
      .from('matches')
      .select(
        'id, final_score, is_playoff_game, shirts_ban, shirts_ban2, skins_ban1, skins_ban2, shirts_pick, skins_starting_side, weeks(seasons(is_gauntlet))',
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

  const { shirts, skins, player_stats } = body as {
    shirts: unknown;
    skins: unknown;
    player_stats: unknown;
  };

  if (typeof shirts !== 'number' || typeof skins !== 'number' || !Number.isInteger(shirts) || !Number.isInteger(skins)) {
    return NextResponse.json({ error: 'shirts and skins must be integers' }, { status: 400 });
  }
  if (shirts < 0 || skins < 0) {
    return NextResponse.json({ error: 'Scores cannot be negative' }, { status: 400 });
  }
  if (!Array.isArray(player_stats) || player_stats.length === 0) {
    return NextResponse.json({ error: 'player_stats must be a non-empty array' }, { status: 400 });
  }

  const roundsPlayed = shirts + skins;

  // Validate each player stat row
  const statsByPlayerId = new Map<number, { player_id: number; faction: string }>();
  for (const s of allStats) statsByPlayerId.set(s.player_id, s);

  const updates: Array<{
    player_id: number;
    kills: number;
    assists: number;
    deaths: number;
    damage: number;
    adr: number;
    rounds_played: number;
    rounds_won: number;
    is_win: boolean;
  }> = [];

  for (const row of player_stats as PlayerStatInput[]) {
    if (typeof row.player_id !== 'number') {
      return NextResponse.json({ error: 'Each stat row must have a numeric player_id' }, { status: 400 });
    }
    const statRow = statsByPlayerId.get(row.player_id);
    if (!statRow) {
      return NextResponse.json({ error: `player_id ${row.player_id} is not in this match` }, { status: 400 });
    }
    for (const field of ['kills', 'assists', 'deaths', 'damage'] as const) {
      if (typeof row[field] !== 'number' || !Number.isInteger(row[field]) || row[field] < 0) {
        return NextResponse.json(
          { error: `${field} must be a non-negative integer for player_id ${row.player_id}` },
          { status: 400 },
        );
      }
    }
    if (row.adr != null && (typeof row.adr !== 'number' || row.adr < 0)) {
      return NextResponse.json(
        { error: `adr must be a non-negative number for player_id ${row.player_id}` },
        { status: 400 },
      );
    }

    const faction = statRow.faction;
    const roundsWon = faction === 'SHIRTS' ? shirts : skins;
    const isWin = faction === 'SHIRTS' ? shirts > skins : skins > shirts;
    const adr =
      row.adr != null
        ? Math.round(row.adr)
        : roundsPlayed > 0
          ? Math.round(row.damage / roundsPlayed)
          : 0;

    updates.push({
      player_id: row.player_id,
      kills: row.kills,
      assists: row.assists,
      deaths: row.deaths,
      damage: row.damage,
      adr,
      rounds_played: roundsPlayed,
      rounds_won: roundsWon,
      is_win: isWin,
    });
  }

  // Write final_score first
  const finalScore = `${shirts}-${skins}`;
  const { error: matchErr } = await supabaseAdmin
    .from('matches')
    .update({ final_score: finalScore })
    .eq('id', matchId);
  if (matchErr) {
    return NextResponse.json({ error: matchErr.message }, { status: 500 });
  }

  // Update each player's stat row
  for (const u of updates) {
    const { error: statErr } = await supabaseAdmin
      .from('player_match_stats')
      .update({
        kills: u.kills,
        assists: u.assists,
        deaths: u.deaths,
        damage: u.damage,
        adr: u.adr,
        rounds_played: u.rounds_played,
        rounds_won: u.rounds_won,
        is_win: u.is_win,
      })
      .eq('match_id', matchId)
      .eq('player_id', u.player_id);
    if (statErr) {
      return NextResponse.json({ error: statErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
