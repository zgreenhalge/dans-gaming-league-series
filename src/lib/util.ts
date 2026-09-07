import { mapSlug } from './maps';

/**
 * Whether a DatHost server is actually up and reachable — the shared "on and done booting" check
 * every caller that treats a server as live (vs. mid-boot or off) should use, on both the server
 * (`dathost.ts`'s `DathostServer` is a structural match, so no import needed) and the client (this
 * file, unlike `dathost.ts`, is safe to import from a `'use client'` component). A start/stop
 * in-flight indicator that reimplements this check ad hoc instead of calling it can silently drift
 * from what every other consumer (a connect/join link, a roster, a Stop button) considers "live" —
 * always go through this function, never `server.on && !server.booting` inline.
 */
export function isServerLive(server: { on: boolean; booting: boolean } | null | undefined): boolean {
  return !!server?.on && !server.booting;
}

/** The complement of `isServerLive` that also excludes mid-boot — fully stopped, not booting either.
 *  The shared "can this be started" check, so it can't drift from `isServerLive`'s definition of the
 *  states in between. */
export function isServerOff(server: { on: boolean; booting: boolean } | null | undefined): boolean {
  return !server?.on && !server?.booting;
}

/**
 * Returns true if a `final_score` string represents a real played result.
 * Treats null and "0-0" / "0 - 0" as not yet played (S3 matches are pre-staged
 * with "0-0" placeholders before stats are entered).
 */
export function isPlayedScore(finalScore: string | null | undefined): boolean {
  if (!finalScore) return false;
  return !/^\s*0\s*[-–]\s*0\s*$/.test(finalScore);
}

/**
 * True if `rows` is non-empty and every row's `final_score` is a played result — the shared "is
 * this scope of matches fully played" predicate behind `isWeekComplete()` (`queries/schedule.ts`),
 * `isSeasonFullyPlayed()` (`season-lifecycle.ts`), and gauntlet pod/season completion
 * (`queries/gauntlet.ts`, `gauntlet-engine.ts`). An empty scope (no matches at all) is never
 * "fully played".
 */
export function allMatchesPlayed(rows: { final_score: string | null }[]): boolean {
  return rows.length > 0 && rows.every((m) => isPlayedScore(m.final_score));
}

export const PLAYER_NAME_MIN_LENGTH = 2;
export const PLAYER_NAME_MAX_LENGTH = 32;
const PLAYER_NAME_RE = /^[A-Za-z]+(?: [A-Za-z]+)*$/;

/** Trims and collapses internal whitespace to single spaces — the shared normalization a rename
 * candidate goes through before length/character validation, so the server route (source of
 * truth) and the client editor (early Save-disable) can't drift on what counts as valid. */
export function normalizePlayerName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Letters only, spaces allowed between words, within PLAYER_NAME_{MIN,MAX}_LENGTH. Expects an
 * already-`normalizePlayerName()`-d string. */
export function isValidPlayerName(name: string): boolean {
  return (
    name.length >= PLAYER_NAME_MIN_LENGTH &&
    name.length <= PLAYER_NAME_MAX_LENGTH &&
    PLAYER_NAME_RE.test(name)
  );
}

/**
 * True when `e` is the `AbortError` a `fetch` rejects with once its `AbortSignal`
 * fires — the "this request was intentionally superseded, not a real failure" case
 * every lazy fetch effect needs to distinguish before surfacing an error to the user.
 */
export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

/**
 * Groups rows by map — map names are user-typed strings, so grouping on the raw value
 * would split one map into several buckets on inconsistent casing/punctuation/spacing.
 * Keeps the first-seen casing for display. Buckets by `mapSlug()` (not a looser
 * case/whitespace normalization) so this always agrees with the map-rollup key the
 * `replay-extract` Action derives the same way from a match's own recorded map name —
 * two differently-punctuated names for the same map can never land in different
 * buckets here while still sharing one rollup. `mapOf` returning `null` excludes a row
 * from grouping entirely (e.g. a caller's own eligibility filter), so this stays the
 * one place the normalization lives while callers keep their own filtering/aggregation
 * on top.
 */
export function groupByMap<T>(
  rows: T[],
  mapOf: (row: T) => string | null | undefined,
): Map<string, { display: string; rows: T[] }> {
  const buckets = new Map<string, { display: string; rows: T[] }>();
  for (const r of rows) {
    const map = mapOf(r);
    if (!map) continue;
    const key = mapSlug(map);
    const entry = buckets.get(key) ?? { display: map.trim(), rows: [] };
    entry.rows.push(r);
    buckets.set(key, entry);
  }
  return buckets;
}

/**
 * Parse a route's `[id]` segment into a positive integer match id, or `null` if it isn't one.
 * Shared by every match-scoped API route so the param contract is identical everywhere.
 */
export function parseMatchId(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function relativeTime(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const days = Math.round(diff / 86_400_000);
  if (days > 1) return `in ${days} days`;
  if (days === 1) return 'tomorrow';
  if (days === 0) return 'today';
  if (days === -1) return 'yesterday';
  return `${Math.abs(days)} days ago`;
}

export function fmtWindowDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Compact, deterministic UTC timestamp (`MM-DD HH:MM UTC`), or `null` for a missing/invalid date.
 * Used by admin/ops surfaces where day-granular relative time is too coarse and a fixed UTC render
 * avoids server/client locale drift.
 */
export function fmtUtcShort(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/**
 * Compact elapsed-time label ("2h 14m", "3d 4h", "45m", "<1m") for a millisecond duration. Used by
 * admin surfaces that show how long a background job has been running or took to finish, where a raw
 * timestamp forces the reader to do the subtraction themselves.
 */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(Math.max(ms, 0) / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return '<1m';
}

/** Human label for a match: "Season · Wk N · Match M", falling back to "Match #id". */
export function matchLabel(opts: {
  matchId: number;
  seasonName?: string | null;
  weekNumber?: number | null;
  matchNumber?: number | null;
}): string {
  const parts = [
    opts.seasonName,
    opts.weekNumber != null ? `Wk ${opts.weekNumber}` : null,
    opts.matchNumber != null ? `Match ${opts.matchNumber}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : `Match #${opts.matchId}`;
}

/** "Week N · Match M" (gauntlets say "Round N" instead of "Week N") — the half of `matchTitle()`'s
 *  output that excludes the season name, for callers that render the season and week/match on
 *  separate lines (e.g. Discord notification embeds). */
export function matchWeekLabel(opts: {
  weekNumber: number;
  matchNumber: number;
  isGauntlet: boolean;
}): string {
  const weekLabel = opts.isGauntlet ? `Round ${opts.weekNumber}` : `Week ${opts.weekNumber}`;
  return `${weekLabel} · Match ${opts.matchNumber}`;
}

/** Canonical match title: "Season · Week N · Match M" (gauntlets say "Round N" instead of "Week N"). */
export function matchTitle(opts: {
  seasonName: string;
  weekNumber: number;
  matchNumber: number;
  isGauntlet: boolean;
}): string {
  return `${opts.seasonName} · ${matchWeekLabel(opts)}`;
}

export function weekWindow(
  startDate: string | null,
  weekNumber: number,
): { start: Date; end: Date } | null {
  if (!startDate) return null;
  const [y, m, d] = startDate.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  return {
    start: new Date(base + (weekNumber - 1) * 7 * 86_400_000),
    end: new Date(base + ((weekNumber - 1) * 7 + 6) * 86_400_000),
  };
}

export function extractSeasonNumber(name: string): number | null {
  const m = name.match(/Season\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

/** Returns the canonical display title for a season, e.g. "Season 1". */
export function seasonTitle(name: string): string {
  const num = extractSeasonNumber(name);
  return num != null ? `Season ${num}` : name;
}

/**
 * Maps each regular season ID to its paired gauntlet season ID, matched by
 * season number (e.g. "Season 3" regular ↔ "Season 3" gauntlet). Pairing is
 * name-based, not ID-based — see `extractSeasonNumber`.
 */
export function buildRegularToGauntletMap(
  regularSeasons: { id: number; name: string }[],
  gauntletSeasons: { id: number; name: string }[],
): Map<number, number> {
  const map = new Map<number, number>();
  for (const r of regularSeasons) {
    const n = extractSeasonNumber(r.name);
    if (n == null) continue;
    const g = gauntletSeasons.find((s) => extractSeasonNumber(s.name) === n);
    if (g) map.set(r.id, g.id);
  }
  return map;
}

/**
 * Concatenates whichever of `regularSeasons`/`gauntletSeasons` the include flags currently admit —
 * the "which seasons are in scope" rule shared by `dedupeVisibleSeasons()` below and
 * `useSeasonFilter()`'s own season-validity clamp (`SeasonFilter.tsx`). Kept undeduplicated (unlike
 * `dedupeVisibleSeasons()`) so a caller checking *membership* of a specific id isn't tripped up by
 * `dedupeVisibleSeasons()`'s title-based dedup silently dropping the second of a same-titled
 * regular+gauntlet pair.
 */
export function seasonsInScope<T>(
  regularSeasons: T[],
  gauntletSeasons: T[],
  includeRegular: boolean,
  includeGauntlet: boolean,
): T[] {
  return [
    ...(includeRegular ? regularSeasons : []),
    ...(includeGauntlet ? gauntletSeasons : []),
  ];
}

/**
 * Regular and/or gauntlet seasons (gated by the include flags), deduplicated by `seasonTitle()` so a
 * regular+gauntlet pair sharing the same season number appears once — the season list a "Career"
 * season-select offers.
 */
export function dedupeVisibleSeasons(
  regularSeasons: { id: number; name: string }[],
  gauntletSeasons: { id: number; name: string }[],
  includeRegular: boolean,
  includeGauntlet: boolean,
): { id: number; name: string }[] {
  const seen = new Set<string>();
  return seasonsInScope(regularSeasons, gauntletSeasons, includeRegular, includeGauntlet).filter((s) => {
    const title = seasonTitle(s.name);
    if (seen.has(title)) return false;
    seen.add(title);
    return true;
  });
}

/**
 * Splits a flat season list into `regularSeasons`/`gauntletSeasons` by `is_gauntlet` — the shape
 * `useSeasonFilter()`'s season-validity option takes, for callers (`MapDetailView`, `MapIndexView`)
 * that only have a single flagged list rather than already-split ones (`PlayerView`,
 * `CareerStatsView` build theirs directly from per-season source rows instead).
 */
export function splitSeasonsByGauntlet<T extends { is_gauntlet: boolean }>(
  seasons: T[],
): { regularSeasons: T[]; gauntletSeasons: T[] } {
  return {
    regularSeasons: seasons.filter((s) => !s.is_gauntlet),
    gauntletSeasons: seasons.filter((s) => s.is_gauntlet),
  };
}

/**
 * Shared tab button class — matches the bordered-underline tab pattern used throughout the app.
 * `compact` is for smaller sub-navigation tabs; `accent` uses the site accent color for the
 * active border instead of the primary text color (paired with `compact` in season sub-tabs).
 */
export function tabCls(active: boolean, opts?: { compact?: boolean; accent?: boolean }): string {
  const { compact = false, accent = false } = opts ?? {};
  return [
    compact ? 'px-3 py-1.5 text-[10px]' : 'px-4 py-2.5 text-[11px]',
    'tracked font-semibold transition-colors -mb-px border-b-2',
    active
      ? `${accent ? 'border-[var(--color-site-accent)]' : 'border-[var(--color-text-primary)]'} text-[var(--color-text-primary)]`
      : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
  ].join(' ');
}

/** Two-letter initials from a display name, e.g. "Dan Smith" → "DS", "Dan" → "DA". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/** First word of a display name, e.g. "Dan Smith" → "Dan" — a more readable axis label than initials. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** Win rate as a rounded 0-100 percentage — drives the H2H matrix, detail cards, profile partner bars, and scouting cards. */
export function winRatePct(wins: number, gamesPlayed: number): number {
  return gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0;
}

/** T→white→CT color-mix for a 0-100 rate — white at 50, deepening to T-orange toward 0 and CT-blue toward 100. Used for round win rate. */
export function rateGradientColor(rate: number): string {
  const t = Math.max(0, Math.min(100, rate));
  if (t <= 50) {
    return `color-mix(in srgb, white ${Math.round((t / 50) * 100)}%, var(--color-t))`;
  }
  return `color-mix(in srgb, var(--color-ct) ${Math.round(((t - 50) / 50) * 100)}%, white)`;
}

/** Faint→green color-mix for a 0-100 win rate — the higher the win rate, the deeper the green. Used by the H2H matrix, detail cards, profile partner bars, and scouting cards. */
export function winRateColor(winRate: number): string {
  const t = Math.max(0, Math.min(100, winRate));
  return `color-mix(in srgb, var(--color-accent-green-fill) ${Math.round(t)}%, var(--color-bg-secondary))`;
}

/** CSS color for a side — the site-wide CT=blue / T=orange convention (round-history strip,
 *  replay event feed, round-economy chart, …). `undefined`/`null` (no side, or not yet resolved)
 *  returns `undefined` so a caller styling with it just falls through to the element's default
 *  color rather than picking a fallback on this function's behalf. */
export function sideColor(side: 'CT' | 'T' | null | undefined): string | undefined {
  if (side === 'CT') return 'var(--color-ct)';
  if (side === 'T') return 'var(--color-t)';
  return undefined;
}

/**
 * Canonical leaderboard sort: Wins → RWR% → ADR (all descending).
 * Use this wherever player rows are ranked — never sort by ADR alone.
 * For gauntlet season pages, use canonicalGauntletRankMap (gauntlet-ranking.ts) instead.
 */
export function canonicalSort(
  a: { matches_won: number; rwr_percentage: number; overall_adr: number },
  b: { matches_won: number; rwr_percentage: number; overall_adr: number },
): number {
  return (
    b.matches_won - a.matches_won ||
    b.rwr_percentage - a.rwr_percentage ||
    b.overall_adr - a.overall_adr
  );
}

/** The canonical `rwr_percentage` formula (round-weighted win rate) — every RWR% anywhere in the
 * codebase must go through this, directly or via `deriveRates()` below, which delegates to it. Call
 * this directly (not `deriveRates()`) when only round totals are in scope. */
export function deriveRwr(totals: { total_rounds_played: number; total_rounds_won: number }): number {
  return totals.total_rounds_played > 0 ? (totals.total_rounds_won / totals.total_rounds_played) * 100 : 0;
}

/** The canonical `overall_adr` formula (average damage per round) — every ADR anywhere in the
 * codebase must go through this, directly or via `deriveRates()` below, which delegates to it. Call
 * this directly (not `deriveRates()`) when only round/damage totals are in scope. */
export function deriveAdr(totals: { total_rounds_played: number; total_damage: number }): number {
  return totals.total_rounds_played > 0 ? totals.total_damage / totals.total_rounds_played : 0;
}

/**
 * Derives the four canonical leaderboard rates from summed totals — `rwr_percentage`/`overall_adr`
 * (two of the three `canonicalSort` keys, alongside `matches_won` from the raw totals) via
 * `deriveRwr()`/`deriveAdr()` above (the real implementations), `win_rate_percentage`/`kd_ratio`
 * computed directly here. Every place that aggregates per-match stats into a leaderboard row must
 * derive these the same way — keep this the single source so the rankings can't drift between the
 * player, career, and map views. Callers do their own summation (input shapes differ); this only
 * does the division + zero-guards. A caller with only round/damage totals in scope (not the full set
 * below) should call `deriveRwr()`/`deriveAdr()` directly instead of fabricating the other fields to
 * satisfy this signature.
 */
export function deriveRates(totals: {
  matches_played: number;
  matches_won: number;
  total_kills: number;
  total_deaths: number;
  total_rounds_played: number;
  total_rounds_won: number;
  total_damage: number;
}): {
  win_rate_percentage: number;
  kd_ratio: number;
  rwr_percentage: number;
  overall_adr: number;
} {
  const { matches_played: mp, matches_won: mw, total_kills, total_deaths } = totals;
  return {
    win_rate_percentage: mp > 0 ? (mw / mp) * 100 : 0,
    kd_ratio: total_deaths > 0 ? total_kills / total_deaths : total_kills,
    rwr_percentage: deriveRwr(totals),
    overall_adr: deriveAdr(totals),
  };
}

/**
 * Sorts match summaries most-recent-first: season number desc → gauntlet before regular (within
 * the same season number) → week desc → match number desc. Gauntlet seasons carry the same season
 * number as their paired regular season but happened later, so they sort above it in the list.
 * Use the negated result for ascending (oldest-first) sorts.
 */
export function compareMatchRefDesc(
  a: { seasonNumber: number | null; isGauntlet: boolean; weekNumber: number; matchNumber: number },
  b: { seasonNumber: number | null; isGauntlet: boolean; weekNumber: number; matchNumber: number },
): number {
  const sa = a.seasonNumber ?? -1;
  const sb = b.seasonNumber ?? -1;
  if (sa !== sb) return sb - sa;
  if (a.isGauntlet !== b.isGauntlet) return a.isGauntlet ? -1 : 1;
  if (a.weekNumber !== b.weekNumber) return b.weekNumber - a.weekNumber;
  return b.matchNumber - a.matchNumber;
}

/** Stakes copy for a gauntlet pod, shown wherever its matches render — shared so the round list
 * and the match detail page can't drift. Not shown for the final pod (advance_rule is unused
 * there; nobody "advances" from it — canonicalGauntletRankMap (gauntlet-ranking.ts) ranks it on
 * read instead). */
export const GAUNTLET_POD_STAKES_LABEL: Record<'single' | 'wildcard', string> = {
  single: 'Elimination pod — win both games to survive (3 of 4 are out).',
  wildcard: 'Wildcard pod — only last place is eliminated (3 of 4 advance).',
};

export function avgOf(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

export function formatEhogDelta(delta: number): string {
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`;
}

/** Parses "13-9" / "13 – 9" into { shirts, skins }. Returns null if unparseable. */
export function parseScore(
  s: string | null | undefined,
): { shirts: number; skins: number } | null {
  if (!s) return null;
  const m = s.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (!m) return null;
  return { shirts: Number(m[1]), skins: Number(m[2]) };
}

/** DOM id for a schedule week's row container — the `?week=<id>` deep-link scroll target
 * (`SeasonTabView`'s deep-link handling reads it back via `getElementById`). Shared between
 * `ScheduleList` (which sets it) and `SeasonTabView` (which reads it) so the two can't drift. */
export function weekAnchorId(weekId: number): string {
  return `week-${weekId}`;
}

/** DOM id for a gauntlet round's row container — the `?round=<n>` deep-link scroll target, same
 * shared-contract reasoning as `weekAnchorId`. */
export function roundAnchorId(roundNumber: number): string {
  return `round-${roundNumber}`;
}

/** Narrows a league/season-wide match-scoped row list (round outcomes, kills, ...) down to the
 *  rows belonging to `matches` — the cross-season views (career, map detail, player) fetch such
 *  data unscoped, then filter to whatever season/side selection the caller already applied to
 *  `matches`. */
export function filterByMatchIds<R extends { match_id: number }>(
  rows: R[],
  matches: { match_id: number }[],
): R[] {
  const matchIds = new Set(matches.map((m) => m.match_id));
  return rows.filter((r) => matchIds.has(r.match_id));
}

/** T-orange/CT-blue/neutral color for a faction — shared by every view that colors a
 *  shirts/skins pairing by starting side (Scouting Report, a match's own H2H tab, the win
 *  probability bar). Lives here rather than in a `'use client'` component module so a Server
 *  Component can call it directly without invoking a client-only function reference. */
export function factionColor(f: 'CT' | 'T' | null): string {
  if (f === 'T') return 'var(--color-t)';
  if (f === 'CT') return 'var(--color-ct)';
  return 'var(--color-text-secondary)';
}
