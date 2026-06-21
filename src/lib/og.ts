import { supabase } from '@/lib/supabase';
import { isPlayedScore, parseScore, canonicalSort } from '@/lib/util';
import { mapImageFor, toSentenceCase } from '@/lib/maps';
import type { Player, Match, Week, Season, PlayerMatchStat } from '@/lib/types';

type LeaderboardAgg = {
  matches_played: number;
  matches_won: number;
  total_kills: number;
  total_deaths: number;
  total_damage: number;
  total_rounds_played: number;
};

export async function getPlayerMeta(playerId: number) {
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

  const wr = agg.matches_played > 0 ? ((agg.matches_won / agg.matches_played) * 100).toFixed(0) : null;
  const kd = agg.total_deaths > 0 ? (agg.total_kills / agg.total_deaths).toFixed(2) : null;
  const adr = agg.total_rounds_played > 0 ? (agg.total_damage / agg.total_rounds_played).toFixed(2) : null;
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
}

export async function getMatchMeta(matchId: number) {
  const { data: match } = await supabase
    .from('matches')
    .select('id, week_id, match_number, final_score, picked_map, shirts_pick, scheduled_at')
    .eq('id', matchId)
    .maybeSingle();
  if (!match) return null;
  const m = match as Pick<Match, 'id' | 'week_id' | 'match_number' | 'final_score' | 'picked_map' | 'shirts_pick' | 'scheduled_at'>;

  const { data: week } = await supabase
    .from('weeks')
    .select('id, season_id, week_number')
    .eq('id', m.week_id)
    .maybeSingle();
  if (!week) return null;
  const w = week as Pick<Week, 'id' | 'season_id' | 'week_number'>;

  const [{ data: season }, { data: stats }] = await Promise.all([
    supabase.from('seasons').select('id, name, is_gauntlet').eq('id', w.season_id).maybeSingle(),
    supabase.from('player_match_stats').select('player_id, faction').eq('match_id', matchId),
  ]);
  if (!season) return null;
  const s = season as Pick<Season, 'id' | 'name' | 'is_gauntlet'>;

  const weekLabel = s.is_gauntlet ? `Round ${w.week_number}` : `Week ${w.week_number}`;
  const title = `${s.name} · ${weekLabel} · Match ${m.match_number}`;

  const map = m.shirts_pick ?? m.picked_map;
  const mapName = map ? toSentenceCase(map) : null;
  const played = isPlayedScore(m.final_score);

  const playerRows = (stats ?? []) as Pick<PlayerMatchStat, 'player_id' | 'faction'>[];
  const shirtIds = playerRows.filter(p => p.faction === 'SHIRTS').map(p => p.player_id);
  const skinIds = playerRows.filter(p => p.faction === 'SKINS').map(p => p.player_id);

  const names: Map<number, string> = new Map();
  const allIds = [...shirtIds, ...skinIds];
  if (allIds.length > 0) {
    const { data: players } = await supabase.from('players').select('id, name').in('id', allIds);
    for (const p of (players ?? []) as Pick<Player, 'id' | 'name'>[]) names.set(p.id, p.name);
  }

  const shirtNames = shirtIds.map(id => names.get(id) ?? '?').join(' & ');
  const skinNames = skinIds.map(id => names.get(id) ?? '?').join(' & ');

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

  const image = map ? mapImageFor(map) ?? null : null;

  return { title, description, image, shirtNames, skinNames, score, mapName, scheduledAt };
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
      .select('player_id, player_name, win_rate_percentage, kd_ratio, total_damage, total_rounds_played')
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
        rwr_percentage: rwr && rwr.played > 0 ? (rwr.won / rwr.played) * 100 : 0,
        overall_adr: r.total_rounds_played > 0 ? r.total_damage / r.total_rounds_played : 0,
        kd_ratio: r.kd_ratio,
      };
    })
    .sort(canonicalSort)
    .slice(0, 4);
}

async function getGauntletSeasonMeta(seasonId: number): Promise<SeasonLeaderboardMeta[]> {
  const { data: weekRows } = await supabase.from('weeks').select('id').eq('season_id', seasonId);
  const weekIds = ((weekRows ?? []) as { id: number }[]).map(w => w.id);
  if (weekIds.length === 0) return [];

  const { data: matchRows } = await supabase
    .from('matches')
    .select('id, final_score')
    .in('week_id', weekIds)
    .eq('is_playoff_game', true);
  const matchIds = ((matchRows ?? []) as { id: number; final_score: string | null }[])
    .filter(m => isPlayedScore(m.final_score))
    .map(m => m.id);
  if (matchIds.length === 0) return [];

  const [{ data: stats }, { data: players }] = await Promise.all([
    supabase
      .from('player_match_stats')
      .select('player_id, kills, deaths, damage, rounds_played, rounds_won, is_win')
      .in('match_id', matchIds),
    supabase.from('players').select('id, name'),
  ]);

  const namesById = new Map<number, string>();
  for (const p of (players ?? []) as Pick<Player, 'id' | 'name'>[]) namesById.set(p.id, p.name);

  type Agg = { mp: number; mw: number; kills: number; deaths: number; damage: number; rp: number; rw: number };
  const byPlayer = new Map<number, Agg>();
  for (const s of (stats ?? []) as { player_id: number; kills: number; deaths: number; damage: number; rounds_played: number; rounds_won: number; is_win: boolean }[]) {
    const prev = byPlayer.get(s.player_id) ?? { mp: 0, mw: 0, kills: 0, deaths: 0, damage: 0, rp: 0, rw: 0 };
    prev.mp += 1;
    prev.mw += s.is_win ? 1 : 0;
    prev.kills += s.kills;
    prev.deaths += s.deaths;
    prev.damage += s.damage;
    prev.rp += s.rounds_played;
    prev.rw += s.rounds_won;
    byPlayer.set(s.player_id, prev);
  }

  return Array.from(byPlayer.entries())
    .filter(([, a]) => a.rp > 0)
    .map(([id, a]) => ({
      player_name: namesById.get(id) ?? '?',
      win_rate_percentage: a.mp > 0 ? (a.mw / a.mp) * 100 : 0,
      rwr_percentage: a.rp > 0 ? (a.rw / a.rp) * 100 : 0,
      overall_adr: a.rp > 0 ? a.damage / a.rp : 0,
      kd_ratio: a.deaths > 0 ? a.kills / a.deaths : a.kills,
    }))
    .sort(canonicalSort)
    .slice(0, 4);
}
