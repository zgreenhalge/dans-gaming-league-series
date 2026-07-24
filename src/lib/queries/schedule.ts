import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import type { Week, Match, PlayerMatchStat, Faction } from '../types';
import { allMatchesPlayed } from '../util';
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

/** Fetches `final_score` for every match in the given weeks — the shared fetch shape behind
 * `isSeasonFullyPlayed()` (`season-lifecycle.ts`), used wherever a caller already has week ids in
 * hand (`isWeekComplete()` below fetches by season+week number in a single joined query instead,
 * since it doesn't have a week id yet). Accepts a client so callers with an admin `SupabaseClient`
 * (season-lifecycle's) can pass it through. */
export async function getMatchScoresForWeeks(
  client: SupabaseClient,
  weekIds: number[],
): Promise<{ final_score: string | null }[]> {
  if (weekIds.length === 0) return [];
  const { data, error } = await client
    .from('matches')
    .select('final_score')
    .in('week_id', weekIds);
  if (error) throw error;
  return (data ?? []) as { final_score: string | null }[];
}

/** True if the given week exists, has at least one match, and every match in it has a final,
 * played score. */
export async function isWeekComplete(
  seasonId: number,
  weekNumber: number,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('matches')
    .select('final_score, weeks!inner(season_id, week_number)')
    .eq('weeks.season_id', seasonId)
    .eq('weeks.week_number', weekNumber);
  if (error) throw error;
  return allMatchesPlayed((data ?? []) as { final_score: string | null }[]);
}
