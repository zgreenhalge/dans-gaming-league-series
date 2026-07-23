import { supabase } from '../supabase';
import type { Week, Match, PlayerMatchStat, Faction } from '../types';
import { isPlayedScore } from '../util';
import { getPlayersById } from './player';


export interface RosterStat {
  match_id: number;
  player_id: number;
  player_name: string;
  faction: Faction;
  kills: number;
  assists: number;
  deaths: number;
  adr: number;
  is_win: boolean;
}

export interface MatchWithRoster extends Match {
  shirts: { player_id: number; player_name: string }[];
  skins: { player_id: number; player_name: string }[];
  shirts_stats: RosterStat[];
  skins_stats: RosterStat[];
}

export interface WeekWithMatches extends Week {
  bye_player_name: string | null;
  matches: MatchWithRoster[];
}

/** Weeks + matches + per-match Shirts/Skins rosters (from player_match_stats). */
export async function getSeasonSchedule(
  seasonId: number,
): Promise<WeekWithMatches[]> {
  const [{ data: weeks, error: wErr }, players] = await Promise.all([
    supabase
      .from('weeks')
      .select('*')
      .eq('season_id', seasonId)
      .order('week_number'),
    getPlayersById(),
  ]);
  if (wErr) throw wErr;
  const weekRows = (weeks ?? []) as Week[];
  if (weekRows.length === 0) return [];

  const weekIds = weekRows.map((w) => w.id);
  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select('*')
    .in('week_id', weekIds)
    .order('match_number');
  if (mErr) throw mErr;
  const matchRows = (matches ?? []) as Match[];
  const matchIds = matchRows.map((m) => m.id);

  let stats: PlayerMatchStat[] = [];
  if (matchIds.length > 0) {
    const { data: s, error: sErr } = await supabase
      .from('player_match_stats')
      .select('*')
      .in('match_id', matchIds);
    if (sErr) throw sErr;
    stats = (s ?? []) as PlayerMatchStat[];
  }

  type StatRow = {
    match_id: number;
    player_id: number;
    faction: 'SHIRTS' | 'SKINS';
    kills: number;
    assists: number;
    deaths: number;
    adr: number;
    is_win: boolean;
  };

  const statsByMatch = new Map<number, StatRow[]>();
  for (const s of stats as StatRow[]) {
    const list = statsByMatch.get(s.match_id) ?? [];
    list.push(s);
    statsByMatch.set(s.match_id, list);
  }

  const matchesByWeek = new Map<number, MatchWithRoster[]>();
  for (const m of matchRows) {
    const roster = (statsByMatch.get(m.id) ?? []) as StatRow[];
    const shirtsStats = roster
      .filter((r) => r.faction === 'SHIRTS')
      .map((r) => ({
        match_id: r.match_id,
        player_id: r.player_id,
        player_name: players.get(r.player_id)?.name ?? `#${r.player_id}`,
        faction: 'SHIRTS' as const,
        kills: r.kills,
        assists: r.assists ?? 0,
        deaths: r.deaths,
        adr: r.adr,
        is_win: !!r.is_win,
      }));
    const skinsStats = roster
      .filter((r) => r.faction === 'SKINS')
      .map((r) => ({
        match_id: r.match_id,
        player_id: r.player_id,
        player_name: players.get(r.player_id)?.name ?? `#${r.player_id}`,
        faction: 'SKINS' as const,
        kills: r.kills,
        assists: r.assists ?? 0,
        deaths: r.deaths,
        adr: r.adr,
        is_win: !!r.is_win,
      }));

    const list = matchesByWeek.get(m.week_id) ?? [];
    // Attach stats arrays as shirts_stats/skins_stats (may be empty)
    list.push({ ...m, shirts: shirtsStats.map(s => ({ player_id: s.player_id, player_name: s.player_name })), skins: skinsStats.map(s => ({ player_id: s.player_id, player_name: s.player_name })), shirts_stats: shirtsStats, skins_stats: skinsStats });
    matchesByWeek.set(m.week_id, list);
  }

  return weekRows.map((w) => ({
    ...w,
    bye_player_name: w.bye_player_id
      ? players.get(w.bye_player_id)?.name ?? null
      : null,
    matches: matchesByWeek.get(w.id) ?? [],
  }));
}

/** True if the given week exists, has at least one match, and every match in it has a final,
 * played score. */
export async function isWeekComplete(
  seasonId: number,
  weekNumber: number,
): Promise<boolean> {
  const { data: week, error: wErr } = await supabase
    .from('weeks')
    .select('id')
    .eq('season_id', seasonId)
    .eq('week_number', weekNumber)
    .maybeSingle();
  if (wErr) throw wErr;
  if (!week) return false;

  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select('final_score')
    .eq('week_id', week.id);
  if (mErr) throw mErr;
  const rows = (matches ?? []) as { final_score: string | null }[];
  if (rows.length === 0) return false;
  return rows.every((m) => isPlayedScore(m.final_score));
}
