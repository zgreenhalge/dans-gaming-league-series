import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import type { Week, Match, Faction } from '../types';
import { allMatchesPlayed, isPlayedScore, weekWindow, upcomingScheduledMatches, upcomingUnscheduledMatches } from '../util';
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
  rounds_won: number;
  rounds_played: number;
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
      rounds_won: r.rounds_won,
      rounds_played: r.rounds_played,
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

export interface SeasonMatchSummary {
  id: number;
  week_number: number;
  match_number: number;
  scheduled_at: string | null;
}

export interface SeasonMatchSummaries {
  weekCount: number;
  matches: SeasonMatchSummary[];
}

/** A season's match/week counts and light per-match listing (id, week/match number, scheduled_at) —
 *  everything the season detail page's header and structured-data (JSON-LD) need, without
 *  `getSeasonSchedule()`'s full per-match roster embed (`player_match_stats`). Kept separate so the
 *  page can show accurate counts regardless of which tab (Regular Season vs. Gauntlet) is initially
 *  rendered, without eagerly paying for the heavy roster-embedded schedule either way. One embedded
 *  query (weeks -> matches), same pattern as `getSeasonSchedule()` above, instead of a `weeks` round
 *  trip followed by a second `matches` one. */
export async function getSeasonMatchSummaries(
  seasonId: number,
  client: SupabaseClient = supabase,
): Promise<SeasonMatchSummaries> {
  const { data: weeks, error: wErr } = await client
    .from('weeks')
    .select('week_number, matches(id, match_number, scheduled_at)')
    .eq('season_id', seasonId);
  if (wErr) throw wErr;
  // Supabase types embedded to-many relations as arrays already, so no unwrap needed at that level —
  // still cast through unknown since the generated Database type doesn't model this nested select
  // shape (same pattern as getSeasonSchedule()'s own embed above).
  const weekRows = (weeks ?? []) as unknown as {
    week_number: number;
    matches: { id: number; match_number: number; scheduled_at: string | null }[];
  }[];

  const summaries = weekRows
    .flatMap((w) => w.matches.map((m) => ({ id: m.id, week_number: w.week_number, match_number: m.match_number, scheduled_at: m.scheduled_at })))
    .sort((a, b) => a.week_number - b.week_number || a.match_number - b.match_number);

  return { weekCount: weekRows.length, matches: summaries };
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
 *  back to the first week with any matches when the season has no `start_date` yet. Shared by
 *  `getUpcomingGames()` (below) and the `/scheduled` Discord command (#396) so they can't drift on
 *  what "current week" means. */
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

/** The first week (by `week_number`) with no played matches yet — what "publish next week's match
 *  threads" (`publishWeekThreads()`, `discord-threads.ts`) means by "next", deliberately independent
 *  of `findCurrentWeek()`'s calendar window. Matches often get entered out of chronological order
 *  (`docs/patterns.md`), so the calendar-current week can already be fully or partially played while
 *  a later week hasn't started — threads belong on that untouched week, not on one that's mid-play.
 *  Falls back to the last week if every week already has at least one played match. */
export function findNextUnplayedWeek(schedule: WeekWithMatches[]): WeekWithMatches | null {
  if (schedule.length === 0) return null;
  const untouched = schedule.find((w) => !w.matches.some((m) => isPlayedScore(m.final_score)));
  return untouched ?? schedule[schedule.length - 1];
}

/** The minimal shape the home page's Upcoming Games panel renders — deliberately narrower than
 *  `MatchWithRoster` (which satisfies it structurally, so regular-season rows need no mapping) so
 *  `gauntletMatchToUpcomingGameRow()` (`gauntlet.ts`) can adapt the differently-shaped `GauntletMatch`
 *  (`shirts_stats`/`skins_stats` instead of `shirts`/`skins`) into the same row type. */
export interface UpcomingGameRow {
  id: number;
  match_number: number;
  scheduled_at: string | null;
  picked_map: string | null;
  shirts_pick: string | null;
  is_feature_match: boolean;
  shirts: { player_id: number; player_name: string }[];
  skins: { player_id: number; player_name: string }[];
}

/** The two buckets behind the home page's Upcoming Games panel — generic over the season's own
 *  match shape (`MatchWithRoster` for a regular season below, `GauntletMatch` for
 *  `getUpcomingGauntletGames()` in `gauntlet.ts`) so both share one result shape without forcing a
 *  gauntlet match into the regular-season type. */
export interface UpcomingGamesOf<T> {
  /** Unplayed matches with a `scheduled_at` time, soonest first. */
  scheduled: T[];
  /** Unplayed, unscheduled matches still needing a time assigned. */
  unscheduled: T[];
}

export type UpcomingGames = UpcomingGamesOf<MatchWithRoster>;

/** Powers the home page's Upcoming Games panel for a regular season: every unplayed match that
 *  already has a time (regardless of which week it falls in), plus the unplayed matches in the
 *  current/next week (`findCurrentWeek()`) that still don't — a gauntlet season has no weekly
 *  structure to anchor that second bucket on, so it uses `getUpcomingGauntletGames()` (`gauntlet.ts`)
 *  instead. */
export function getUpcomingGames(schedule: WeekWithMatches[], startDate: string | null): UpcomingGames {
  const scheduled = upcomingScheduledMatches(schedule.flatMap((w) => w.matches));

  const currentWeek = findCurrentWeek(schedule, startDate);
  const unscheduled = currentWeek ? upcomingUnscheduledMatches(currentWeek.matches) : [];

  return { scheduled, unscheduled };
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
