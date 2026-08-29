import { gunzipMaybe } from '../gzip';
import { getR2Object } from '../r2';
import { supabase } from '../supabase';
import { isPlayedScore } from '../util';
import type { Faction } from '../types';

const SUPABASE_PAGE_SIZE = 1000;

/**
 * Casts a Supabase query result to the `{ data: T[] | null; error }` shape `fetchAllPages`/
 * `batchedIn` expect. The generated `Database` type checks a query's columns are real, but its
 * per-column nullability is the schema's, which is sometimes looser than a caller's own narrower
 * type trusts by app-level invariant (e.g. a nullable FK column ingestion always populates) — this
 * is that narrowing, applied once at each call site instead of restating the target shape inline.
 */
export function asPage<T>(
  query: PromiseLike<unknown>,
): PromiseLike<{ data: T[] | null; error: { message: string } | null }> {
  return query as unknown as PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
}

/**
 * Runs `buildQuery` across successive `.range()` windows until a page comes back short,
 * working around PostgREST's default 1000-row response cap — a plain `.select()` (or a
 * `.limit()` above 1000) silently truncates once a table grows past that, biasing any
 * aggregate computed from the result. Pass a query builder rather than a built query so this
 * can attach `.range()` per page.
 */
export async function fetchAllPages<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const results: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await buildQuery(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    results.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return results;
}

/** `.in()` batch size — keeps the request URL well under PostgREST/proxy length limits when a
 *  caller's id list itself runs into the thousands. */
export const SUPABASE_IN_BATCH = 200;

/**
 * Runs a `.in(column, ids)` select in `SUPABASE_IN_BATCH`-sized id chunks, each chunk itself
 * paginated via `fetchAllPages()` — covers both truncation risks a large `.in()` list carries:
 * the id list overflowing a safe URL length, and any single chunk's result overflowing
 * PostgREST's row cap.
 */
export async function batchedIn<T>(
  table: string,
  column: string,
  ids: number[],
  select: string,
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < ids.length; i += SUPABASE_IN_BATCH) {
    const chunk = ids.slice(i, i + SUPABASE_IN_BATCH);
    // `table` is caller-supplied and genuinely dynamic across this helper's call sites, so it can't
    // be narrowed to the generated client's per-table literal union — `asPage<T>` below covers the
    // rest of the result shape.
    const page = await fetchAllPages<T>((from, to) =>
      asPage<T>(supabase.from(table as never).select(select).in(column, chunk).range(from, to)),
    );
    results.push(...page);
  }
  return results;
}

/**
 * Which of `requested` aren't present in `covered` — a plain set difference, used
 * wherever a precomputed artifact (issue #127) only partially answers a request:
 * `getMapHeatmapPoints()` and `getPlayerRoundTraces()` both use this to find which
 * match ids a map-level rollup doesn't cover yet (`covered` = the rollup's own
 * `matchIds`), and `getPlayerRoundTraces()` reuses it again to find which of those
 * still aren't answered by a compact per-match artifact fetch, before falling back
 * further. Each caller fetches only this delta directly.
 */
export function missingIds(requested: number[], covered: number[] | undefined): number[] {
  const coveredSet = new Set(covered ?? []);
  return requested.filter((id) => !coveredSet.has(id));
}

/**
 * Resolves `week_id -> { season_id, week_number }` — the `weeks` -> `seasons` half of the
 * `matches` -> `weeks` -> `seasons` join every season-scoped query needs. Pass `seasonIds` to
 * scope to specific seasons (e.g. gauntlet seasons); omit it to resolve every week in the league.
 */
export type WeekLookup = Map<number, { season_id: number; week_number: number }>;

export async function getWeekLookup(seasonIds?: number[]): Promise<WeekLookup> {
  let query = supabase.from('weeks').select('id, season_id, week_number');
  if (seasonIds) query = query.in('season_id', seasonIds);
  const { data, error } = await query;
  if (error) throw error;

  const lookup: WeekLookup = new Map();
  for (const w of (data ?? []) as { id: number; season_id: number; week_number: number }[])
    lookup.set(w.id, { season_id: w.season_id, week_number: w.week_number });
  return lookup;
}

/** `getWeekLookup()`'s entries as `{id, season_id, week_number}` rows — for callers that need to
 *  filter/sort/iterate them as a list rather than look up by id. */
export function weekRowsFromLookup(lookup: WeekLookup): { id: number; season_id: number; week_number: number }[] {
  return Array.from(lookup, ([id, w]) => ({ id, ...w }));
}

/**
 * Get-or-init a `Map<string, T>` entry (seeded from `zero` on first touch) and add `amount` to one
 * numeric field — the shared "counter record keyed by `` `${match_id}:${player_id}` `` " primitive
 * every per-player `derive*()` aggregator in this file's siblings needs (side-split counts, clutch
 * counts, utility counts), rather than each hand-rolling its own get-or-init-then-increment.
 */
export function bumpCounter<T, K extends keyof T>(
  out: Map<string, T>,
  key: string,
  zero: T,
  field: K,
  amount = 1,
): void {
  let c = out.get(key);
  if (!c) {
    c = { ...zero };
    out.set(key, c);
  }
  // `T`'s fields are numeric by every caller's contract (a counts record like `SideSplitCounts`/
  // `ClutchCounts`/`UtilityCounts`), but a plain `interface` gets no implicit index signature, so
  // `T` can't be constrained to `Record<string, number>` without breaking every call site — hence
  // the cast through `unknown` rather than a tighter generic bound.
  c[field] = ((c[field] as unknown as number) + amount) as unknown as T[K];
}

export type PmsRow = { id: number; player_id: number; match_id: number };

/** Resolves `player_match_stats.id -> {id, player_id, match_id}` — the FK-to-`player_id` lookup
 *  every fact-table reader needs (`match_kills`/`match_utility_throws` rows are keyed by
 *  `player_match_stats_id`, but every `derive*()` consumer works in `player_id`). Pass `rows` when
 *  the caller already fetched `player_match_stats` (e.g. `getAllSabremetrics()`'s own
 *  `id, player_id, match_id, rounds_played` read, structurally compatible) to skip a redundant
 *  full-table fetch; pass `matchId` to scope an actual fetch to one match. */
export function fetchPmsLookup(
  matchId?: number,
  rows?: PmsRow[] | Promise<PmsRow[]>,
): Promise<Map<number, PmsRow>> {
  const rowsPromise = rows
    ? Promise.resolve(rows)
    : fetchAllPages<PmsRow>((from, to) => {
        let q = supabase.from('player_match_stats').select('id, player_id, match_id');
        if (matchId != null) q = q.eq('match_id', matchId);
        return asPage(q.range(from, to));
      });
  return rowsPromise.then((r) => new Map(r.map((x) => [x.id, x])));
}

export type PmsFactionRow = PmsRow & { faction: Faction };

/** Like `fetchPmsLookup()`, but also carrying `faction` — for a caller that needs to resolve a
 *  round's side (`resolveSide()`, `parsers/roundSides.ts`) as well as the player_id, without a
 *  second `player_match_stats` read alongside a plain `fetchPmsLookup()` call. Pass `matchId` to
 *  scope to one match. */
export function fetchPmsFactionLookup(matchId?: number): Promise<Map<number, PmsFactionRow>> {
  return fetchAllPages<PmsFactionRow>((from, to) => {
    let q = supabase.from('player_match_stats').select('id, player_id, match_id, faction');
    if (matchId != null) q = q.eq('match_id', matchId);
    return asPage(q.range(from, to));
  }).then((rows) => new Map(rows.map((r) => [r.id, r])));
}

export interface PlayerFactionsAndRoster {
  playerFactions: Map<string, Faction>;
  rosterByMatch: Map<number, number[]>;
}

/** Builds `deriveSideSplitCounts()`/`deriveClutchCounts()`'s two roster inputs from one pass over a
 *  `player_match_stats` read — `playerFactions` (`` `${match_id}:${player_id}` `` → `faction`) and
 *  `rosterByMatch` (every roster `player_id` per `match_id`) — the same construction
 *  `getAllSabremetrics()`, `getMatchSabremetrics()`, `getAllMatchRounds()`, and the demo-upload
 *  preview each need from their own already-fetched roster rows. Lives here (not in `kills.ts`,
 *  where its consumers are) so both `kills.ts` and `weaponStats.ts` can import it without a
 *  circular dependency — `kills.ts` already imports from `weaponStats.ts`. */
export function buildPlayerFactionsAndRoster(
  rows: { match_id: number; player_id: number; faction: Faction }[],
): PlayerFactionsAndRoster {
  const playerFactions = new Map<string, Faction>();
  const rosterByMatch = new Map<number, number[]>();
  for (const r of rows) {
    playerFactions.set(`${r.match_id}:${r.player_id}`, r.faction);
    let roster = rosterByMatch.get(r.match_id);
    if (!roster) {
      roster = [];
      rosterByMatch.set(r.match_id, roster);
    }
    roster.push(r.player_id);
  }
  return { playerFactions, rosterByMatch };
}

export interface RoundSideInfo {
  shirtsSide: 'CT' | 'T';
  winnerSide: 'CT' | 'T';
}

/** Every round's `shirts_side`/`winner_side`, keyed by `` `${match_id}:${round_number}` `` — the raw
 *  ingredient `resolvePlayerSide()` (`queries/kills.ts`) needs to resolve which side a player was on
 *  a given round, plus which side won it (`deriveClutchCounts()`'s win/loss check, and
 *  `getEconomyRoundWins()`'s own win check — `queries/weaponStats.ts`). Lives here rather than
 *  `rounds.ts` for the same circular-dependency reason as `buildPlayerFactionsAndRoster()` above.
 *  No season resolution or `win_reason` join, unlike `getAllMatchRounds()` — side-split/clutch/
 *  economy-win derivation doesn't need either, the same reasoning `getAllKillCreditFlags()`
 *  (`queries/kills.ts`) uses to skip `getAllMatchKills()`'s season/name joins. Pass `matchId` to
 *  scope to one match. */
export async function getRoundSides(matchId?: number): Promise<Map<string, RoundSideInfo>> {
  const rows = await fetchAllPages<{ match_id: number; round_number: number; shirts_side: string; winner_side: string }>(
    (from, to) => {
      let q = supabase.from('match_rounds').select('match_id, round_number, shirts_side, winner_side');
      if (matchId != null) q = q.eq('match_id', matchId);
      return q.range(from, to);
    },
  );
  return new Map(rows.map((r) => [
    `${r.match_id}:${r.round_number}`,
    { shirtsSide: r.shirts_side as 'CT' | 'T', winnerSide: r.winner_side as 'CT' | 'T' },
  ]));
}

/**
 * Resolves `match_id -> season_id` for every played match (`isPlayedScore(final_score)`), via
 * `matches` -> `weeks` -> `seasons` — the join every demo-derived-stat query needs to scope its
 * rows to a season. Shared by `getAllSabremetrics()` and the weapon-class/economy breakdown
 * queries so the join logic can't drift between them.
 */
export async function resolveMatchSeasons(): Promise<Map<number, number>> {
  const [{ data: matchRows, error: matchErr }, weekLookup] = await Promise.all([
    supabase.from('matches').select('id, week_id, final_score'),
    getWeekLookup(),
  ]);
  if (matchErr) throw matchErr;

  const matchSeason = new Map<number, number>();
  for (const m of (matchRows ?? []) as { id: number; week_id: number; final_score: string | null }[]) {
    if (!isPlayedScore(m.final_score)) continue;
    const week = weekLookup.get(m.week_id);
    if (week != null) matchSeason.set(m.id, week.season_id);
  }
  return matchSeason;
}

/**
 * Read a gzipped JSON artifact from R2 at `key`, or `null` if it doesn't exist, fails
 * to parse, or its `version` doesn't match `expectedVersion` — used by the map-level
 * rollup readers (`getMapHeatmapRollup()`, `getMapTraceRollup()`), which share this
 * exact shape and differ only in the R2 key and the expected version. A version
 * mismatch is logged: it means a schema bump shipped without a `replay-extract-all`
 * backfill, so the map is (silently, but not invisibly) degraded to the slower
 * per-match fallback until that backfill runs.
 */
export async function getVersionedR2Json<T extends { version: number }>(
  key: string,
  expectedVersion: number,
): Promise<T | null> {
  const buf = await getR2Object(key);
  if (!buf) return null;
  try {
    const parsed = JSON.parse(gunzipMaybe(buf).toString('utf8')) as T;
    if (parsed.version !== expectedVersion) {
      console.warn(`getVersionedR2Json: ${key} is version ${parsed.version}, expected ${expectedVersion}`);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
