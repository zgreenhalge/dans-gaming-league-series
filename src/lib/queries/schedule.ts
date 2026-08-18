import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import type { Week, Match, Faction } from '../types';
import { allMatchesPlayed, weekWindow } from '../util';
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

type RosterStatRow = Omit<RosterStat, 'player_name'>;

type EmbeddedMatch = Match & { player_match_stats: RosterStatRow[] };
type EmbeddedWeek = Week & { matches: EmbeddedMatch[] };

function buildRosterStats(roster: RosterStatRow[], faction: Faction, players: Map<number, { name: string }>): RosterStat[] {
  return roster
    .filter((r) => r.faction === faction)
    .map((r) => ({
      match_id: r.match_id,
      player_id: r.player_id,
      player_name: players.get(r.player_id)?.name ?? `#${r.player_id}`,
      faction,
      kills: r.kills,
      assists: r.assists ?? 0,
      deaths: r.deaths,
      adr: r.adr,
      is_win: !!r.is_win,
    }));
}

/** Weeks + matches + per-match Shirts/Skins rosters (from player_match_stats) — one embedded
 *  query (weeks -> matches -> player_match_stats) instead of three sequential round trips, each
 *  depending on the previous one's ids. `client` defaults to the app's anon-key client but accepts
 *  an admin client for callers running outside a Next.js request (a GitHub Actions script, which has
 *  no `NEXT_PUBLIC_SUPABASE_ANON_KEY`) — same opt-in pattern as `getMatchIdsForMap()` (`maps.ts`). */
export async function getSeasonSchedule(
  seasonId: number,
  client: SupabaseClient = supabase,
): Promise<WeekWithMatches[]> {
  const [{ data: weeks, error: wErr }, players] = await Promise.all([
    client
      .from('weeks')
      .select('*, matches(*, player_match_stats(*))')
      .eq('season_id', seasonId)
      .order('week_number')
      .order('match_number', { referencedTable: 'matches' }),
    getPlayersById(client),
  ]);
  if (wErr) throw wErr;
  // Supabase types embedded to-many relations as arrays already, so no unwrap needed at that
  // level — still cast through unknown since the generated Database type doesn't model this
  // nested select shape (same pattern as the to-one embeds elsewhere in this codebase).
  const weekRows = (weeks ?? []) as unknown as EmbeddedWeek[];

  return weekRows.map((w) => {
    const { matches, ...weekFields } = w;
    return {
      ...weekFields,
      bye_player_name: w.bye_player_id
        ? players.get(w.bye_player_id)?.name ?? null
        : null,
      matches: matches.map((m): MatchWithRoster => {
        const { player_match_stats: roster, ...matchFields } = m;
        const shirtsStats = buildRosterStats(roster, 'SHIRTS', players);
        const skinsStats = buildRosterStats(roster, 'SKINS', players);
        return {
          ...matchFields,
          shirts: shirtsStats.map((s) => ({ player_id: s.player_id, player_name: s.player_name })),
          skins: skinsStats.map((s) => ({ player_id: s.player_id, player_name: s.player_name })),
          shirts_stats: shirtsStats,
          skins_stats: skinsStats,
        };
      }),
    };
  });
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

/** A week's calendar window as epoch ms, `end` inclusive of the full last day — the numeric-
 *  comparison counterpart to `weekWindow()` (`util.ts`, which returns display `Date`s with `end` at
 *  the start of the last day). Built on the same underlying date math rather than re-deriving it, so
 *  the two can't drift. `startDate` is required here (unlike `weekWindow()`'s nullable one) since
 *  `findCurrentWeek()` below only calls this once it's already checked for a season `start_date`. */
export function weekWindowMs(startDate: string, weekNumber: number): { start: number; end: number } {
  const win = weekWindow(startDate, weekNumber)!;
  return { start: win.start.getTime(), end: win.end.getTime() + 86_399_999 };
}

/** Whichever week "today" falls in, from an already-fetched schedule — the week whose window
 *  contains now, else the next upcoming week, else the last week if every window is past. Falls
 *  back to the first week with any matches when the season has no `start_date` yet. Shared by the
 *  home page's This Week / Next Week panels and the `/scheduled` Discord command (#396) so they
 *  can't drift on what "current week" means. */
export function findCurrentWeek(schedule: WeekWithMatches[], startDate: string | null): WeekWithMatches | null {
  if (schedule.length === 0) return null;

  if (startDate) {
    const now = Date.now();
    const current = schedule.find((w) => {
      const win = weekWindowMs(startDate, w.week_number);
      return now >= win.start && now <= win.end;
    });
    if (current) return current;
    const next = schedule.find((w) => {
      const win = weekWindowMs(startDate, w.week_number);
      return now < win.start;
    });
    if (next) return next;
    return schedule[schedule.length - 1];
  }

  return schedule[0];
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
