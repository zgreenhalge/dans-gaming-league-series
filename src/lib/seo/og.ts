import { cache } from 'react';
import { supabase } from '@/lib/supabase';
import { isPlayedScore, parseScore, canonicalSort, deriveRates, deriveRwr, deriveAdr } from '@/lib/util';
import { mapImageFor, toSentenceCase } from '@/lib/maps';
import { getMapLookup, getMatchTeamNames, getGauntletSeasonLeaderboard } from '../queries';
import type { Player, Match } from '@/lib/types';

type LeaderboardAgg = {
  matches_played: number;
  matches_won: number;
  total_kills: number;
  total_deaths: number;
  total_damage: number;
  total_rounds_played: number;
};

/**
 * `cache()`-wrapped so the identical call from `generateMetadata` and the page component
 * collapses into a single set of Supabase round trips per request.
 */
export const getPlayerMeta = cache(async (playerId: number) => {
  const [{ data: player }, { data: rows }, { data: gauntletRows }, { data: ratingRow }] = await Promise.all([
    supabase
      .from('players')
      .select('id, name, steam_avatar_url')
      .eq('id', playerId)
      .maybeSingle(),
    supabase
      .from('player_season_leaderboard')
      .select('matches_played, matches_won, total_kills, total_deaths, total_damage, total_rounds_played')
      .eq('player_id', playerId),
    supabase
      .from('player_match_stats')
      .select('kills, deaths, damage, rounds_played, is_win, match_id, matches!inner(is_playoff_game)')
      .eq('player_id', playerId)
      .eq('matches.is_playoff_game', true),
    supabase
      .from('player_current_ratings')
      .select('ehog_v1')
      .eq('player_id', playerId)
      .maybeSingle(),
  ]);
  if (!player) return null;
  const p = player as Pick<Player, 'id' | 'name' | 'steam_avatar_url'>;

  const agg: LeaderboardAgg = { matches_played: 0, matches_won: 0, total_kills: 0, total_deaths: 0, total_damage: 0, total_rounds_played: 0 };
  for (const r of (rows ?? []) as LeaderboardAgg[]) {
    agg.matches_played += r.matches_played;
    agg.matches_won += r.matches_won;
    agg.total_kills += r.total_kills;
    agg.total_deaths += r.total_deaths;
    agg.total_damage += r.total_damage;
    agg.total_rounds_played += r.total_rounds_played;
  }
  for (const g of (gauntletRows ?? []) as { kills: number; deaths: number; damage: number; rounds_played: number; is_win: boolean }[]) {
    agg.matches_played += 1;
    agg.matches_won += g.is_win ? 1 : 0;
    agg.total_kills += g.kills;
    agg.total_deaths += g.deaths;
    agg.total_damage += g.damage;
    agg.total_rounds_played += g.rounds_played;
  }

  const ehog: number | null = (ratingRow as { ehog_v1?: number } | null)?.ehog_v1 ?? null;

  const rates = deriveRates({ ...agg, total_rounds_won: 0 });
  const wr = agg.matches_played > 0 ? rates.win_rate_percentage.toFixed(0) : null;
  const kd = agg.total_deaths > 0 ? rates.kd_ratio.toFixed(2) : null;
  const adr = agg.total_rounds_played > 0 ? rates.overall_adr.toFixed(2) : null;
  const record = agg.matches_played > 0 ? `${agg.matches_won}–${agg.matches_played - agg.matches_won}` : null;
  const ehogStr = ehog != null ? ehog.toFixed(2) : null;

  const descParts: string[] = [];
  if (record && wr) descParts.push(`${record} (${wr}% WR)`);
  if (kd) descParts.push(`${kd} K/D`);
  if (adr) descParts.push(`${adr} ADR`);
  if (ehogStr) descParts.push(`${ehogStr} EHOG`);
  const description = descParts.length > 0
    ? `${p.name} — ${descParts.join(' · ')} in DGLS.`
    : `${p.name}'s player profile in DGLS.`;

  return {
    name: p.name,
    description,
    image: p.steam_avatar_url ?? null,
    stats: { wr, kd, adr, record, ehog: ehogStr, ehogRaw: ehog },
  };
});

export async function getMatchMeta(matchId: number) {
  const [teams, { data: match }, mapLookup] = await Promise.all([
    getMatchTeamNames(matchId),
    supabase
      .from('matches')
      .select('final_score, picked_map, shirts_pick, scheduled_at')
      .eq('id', matchId)
      .maybeSingle(),
    getMapLookup(),
  ]);
  if (!teams || !match) return null;
  const m = match as Pick<Match, 'final_score' | 'picked_map' | 'shirts_pick' | 'scheduled_at'>;
  const { title, seasonName, weekMatchLabel, shirtNames, skinNames, shirtPlayers, skinPlayers } = teams;

  const map = m.shirts_pick ?? m.picked_map;
  const mapName = map ? toSentenceCase(map) : null;
  const played = isPlayedScore(m.final_score);

  const score = played && m.final_score ? parseScore(m.final_score) : null;

  let scheduledAt: string | null = null;
  if (m.scheduled_at && !played) {
    const d = new Date(m.scheduled_at);
    const tz = 'America/New_York';
    const fmt = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz });
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
    scheduledAt = `${fmt} at ${time} ET`;
  }

  // Text description for meta tags
  const descParts: string[] = [];
  if (shirtNames && skinNames) descParts.push(`${shirtNames} vs ${skinNames}`);
  if (score) {
    descParts.push(`${score.shirts}–${score.skins}`);
    if (mapName) descParts.push(`on ${mapName}`);
  } else if (scheduledAt) {
    descParts.push(scheduledAt);
    if (mapName) descParts.push(`on ${mapName}`);
  }
  const description = descParts.join(' · ');

  const image = map ? mapImageFor(map, mapLookup) ?? null : null;

  return {
    title, seasonName, weekMatchLabel, description, image,
    shirtNames, skinNames, shirtPlayers, skinPlayers, score, mapName, scheduledAt,
    // The raw ISO timestamp, distinct from the formatted-for-display `scheduledAt` above (which is
    // also gated on `!played` and thus null once a match is scored) — notifyMatchReminder() needs an
    // exact, parseable time to compute its eligibility window, not a display string.
    scheduledAtRaw: m.scheduled_at,
  };
}

type SeasonLeaderboardMeta = {
  player_name: string;
  win_rate_percentage: number;
  rwr_percentage: number;
  overall_adr: number;
  kd_ratio: number;
};

export async function getSeasonMetaLeaderboard(seasonId: number): Promise<SeasonLeaderboardMeta[]> {
  const { data: seasonRow } = await supabase
    .from('seasons')
    .select('is_gauntlet')
    .eq('id', seasonId)
    .maybeSingle();
  const isGauntlet = !!(seasonRow as { is_gauntlet: boolean } | null)?.is_gauntlet;

  if (!isGauntlet) {
    return getRegularSeasonMeta(seasonId);
  }
  return getGauntletSeasonMeta(seasonId);
}

async function getRegularSeasonMeta(seasonId: number): Promise<SeasonLeaderboardMeta[]> {
  type Row = {
    player_id: number;
    player_name: string;
    win_rate_percentage: number;
    matches_won: number;
    kd_ratio: number;
    total_damage: number;
    total_rounds_played: number;
  };

  const { data: weekRows } = await supabase.from('weeks').select('id').eq('season_id', seasonId);
  const weekIds = ((weekRows ?? []) as { id: number }[]).map(w => w.id);
  if (weekIds.length === 0) return [];

  const { data: matchRows } = await supabase.from('matches').select('id').in('week_id', weekIds);
  const matchIds = ((matchRows ?? []) as { id: number }[]).map(m => m.id);

  const [{ data: lbRows }, { data: matchStats }] = await Promise.all([
    supabase
      .from('player_season_leaderboard')
      .select('player_id, player_name, win_rate_percentage, matches_won, kd_ratio, total_damage, total_rounds_played')
      .eq('season_id', seasonId)
      .gt('total_rounds_played', 0),
    matchIds.length > 0
      ? supabase.from('player_match_stats').select('player_id, rounds_won, rounds_played').in('match_id', matchIds)
      : Promise.resolve({ data: [] }),
  ]);

  const rwrByPlayer = new Map<number, { won: number; played: number }>();
  for (const s of (matchStats ?? []) as { player_id: number; rounds_won: number; rounds_played: number }[]) {
    const prev = rwrByPlayer.get(s.player_id) ?? { won: 0, played: 0 };
    prev.won += s.rounds_won ?? 0;
    prev.played += s.rounds_played ?? 0;
    rwrByPlayer.set(s.player_id, prev);
  }

  return ((lbRows ?? []) as Row[])
    .map(r => {
      const rwr = rwrByPlayer.get(r.player_id);
      return {
        player_name: r.player_name,
        win_rate_percentage: r.win_rate_percentage,
        matches_won: r.matches_won,
        rwr_percentage: deriveRwr({ total_rounds_played: rwr?.played ?? 0, total_rounds_won: rwr?.won ?? 0 }),
        overall_adr: deriveAdr({ total_rounds_played: r.total_rounds_played, total_damage: r.total_damage }),
        kd_ratio: r.kd_ratio,
      };
    })
    .sort(canonicalSort)
    .slice(0, 4);
}

async function getGauntletSeasonMeta(seasonId: number): Promise<SeasonLeaderboardMeta[]> {
  const rows = await getGauntletSeasonLeaderboard(seasonId);
  // Exclude any row with no rounds played — a malformed/partial stat row on an
  // otherwise-played match shouldn't surface as a 0%/0.00 entry on the OG card.
  return rows.filter((r) => r.total_rounds_played > 0).slice(0, 4);
}
