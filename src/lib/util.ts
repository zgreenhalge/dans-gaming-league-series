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

/**
 * Canonical leaderboard sort: WR% → RWR% → ADR (all descending).
 * Use this wherever player rows are ranked — never sort by ADR alone.
 * For gauntlet season pages, use canonicalGauntletRankMap instead.
 */
export function canonicalSort(
  a: { win_rate_percentage: number; rwr_percentage: number; overall_adr: number },
  b: { win_rate_percentage: number; rwr_percentage: number; overall_adr: number },
): number {
  return (
    b.win_rate_percentage - a.win_rate_percentage ||
    b.rwr_percentage - a.rwr_percentage ||
    b.overall_adr - a.overall_adr
  );
}

/**
 * Derives the four canonical leaderboard rates (the exact `canonicalSort` keys) from summed totals.
 * Every place that aggregates per-match stats into a leaderboard row must derive these the same way
 * — keep this the single source so the rankings can't drift between the player, career, and map views.
 * Callers do their own summation (input shapes differ); this only does the division + zero-guards.
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
  const { matches_played: mp, matches_won: mw, total_kills, total_deaths, total_rounds_played: rp, total_rounds_won: rw, total_damage } = totals;
  return {
    win_rate_percentage: mp > 0 ? (mw / mp) * 100 : 0,
    kd_ratio: total_deaths > 0 ? total_kills / total_deaths : total_kills,
    rwr_percentage: rp > 0 ? (rw / rp) * 100 : 0,
    overall_adr: rp > 0 ? total_damage / rp : 0,
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

// Minimal types for canonicalGauntletRankMap — mirrors GauntletRound/GauntletMatch
// from queries.ts without creating a circular import.
interface _GauntletPlayer { player_id: number; faction: 'SHIRTS' | 'SKINS'; is_win: boolean; adr: number }
interface _GauntletMatch { final_score: string | null; shirts_stats: _GauntletPlayer[]; skins_stats: _GauntletPlayer[] }
interface _GauntletRound { round_number: number; matches: _GauntletMatch[] }

/**
 * Canonical gauntlet ranking — returns a Map<player_id, rank> (1-indexed) matching
 * the order the podium is determined:
 *   1st  — 2-0 in the final round (champion)
 *   2nd  — 1-1 in the final round, higher final-round RWR% (then ADR)
 *   3rd  — 1-1 in the final round, lower final-round RWR% (then ADR)
 *   4th  — 0-2 in the final round
 *   5th+ — players eliminated before the final round, ordered by latest elimination
 *          round (higher round = better rank); tiebreak within the same round by
 *          wins in that round, then RWR%, then ADR in that round (all descending)
 *
 * Returns an empty map when the gauntlet is not yet complete.
 * Use this instead of canonicalSort wherever gauntlet leaderboards are rendered.
 */
export function canonicalGauntletRankMap(rounds: _GauntletRound[]): Map<number, number> {
  if (rounds.length === 0) return new Map();

  const maxRound = Math.max(...rounds.map((r) => r.round_number));
  const finalRound = rounds.find((r) => r.round_number === maxRound);
  if (!finalRound || !finalRound.matches.every((m) => isPlayedScore(m.final_score))) {
    return new Map();
  }

  // Compute per-player record, RWR% and ADR for a given set of matches.
  // ADR is round-weighted (per-match adr * rounds) so it aggregates correctly.
  function aggregateRound(matches: _GauntletMatch[]) {
    const agg = new Map<number, { wins: number; rounds_won: number; rounds_played: number; total_damage: number }>();
    for (const m of matches) {
      if (!isPlayedScore(m.final_score)) continue;
      const scores = parseScore(m.final_score);
      if (!scores) continue;
      const total = scores.shirts + scores.skins;
      for (const p of [...m.shirts_stats, ...m.skins_stats]) {
        const prev = agg.get(p.player_id) ?? { wins: 0, rounds_won: 0, rounds_played: 0, total_damage: 0 };
        prev.wins += p.is_win ? 1 : 0;
        prev.rounds_won += p.faction === 'SHIRTS' ? scores.shirts : scores.skins;
        prev.rounds_played += total;
        prev.total_damage += p.adr * total;
        agg.set(p.player_id, prev);
      }
    }
    return agg;
  }

  // Determine which players appeared in each round.
  const playerFirstRound = new Map<number, number>();
  const playerLastRound = new Map<number, number>();
  for (const r of rounds) {
    for (const m of r.matches) {
      for (const p of [...m.shirts_stats, ...m.skins_stats]) {
        if (!playerFirstRound.has(p.player_id)) playerFirstRound.set(p.player_id, r.round_number);
        const prev = playerLastRound.get(p.player_id) ?? 0;
        if (r.round_number > prev) playerLastRound.set(p.player_id, r.round_number);
      }
    }
  }

  // Final round: rank 1–4 by record then RWR%.
  const finalAgg = aggregateRound(finalRound.matches);
  const finalPlayers = Array.from(finalAgg.entries()).map(([id, s]) => ({
    player_id: id,
    wins: s.wins,
    rwr: s.rounds_played > 0 ? s.rounds_won / s.rounds_played : 0,
    adr: s.rounds_played > 0 ? s.total_damage / s.rounds_played : 0,
  }));

  finalPlayers.sort((a, b) => b.wins - a.wins || b.rwr - a.rwr || b.adr - a.adr);

  const rankMap = new Map<number, number>();
  finalPlayers.forEach((p, i) => rankMap.set(p.player_id, i + 1));

  // Earlier rounds: players whose last round < maxRound were eliminated there.
  // Later elimination round = better rank. Tiebreak: wins in that round, then RWR%.
  const eliminated: { player_id: number; lastRound: number; wins: number; rwr: number; adr: number }[] = [];
  for (const [id, lastRound] of playerLastRound) {
    if (lastRound >= maxRound) continue;
    const r = rounds.find((r) => r.round_number === lastRound);
    const agg = r ? aggregateRound(r.matches) : new Map();
    const s = agg.get(id);
    eliminated.push({
      player_id: id,
      lastRound,
      wins: s?.wins ?? 0,
      rwr: s && s.rounds_played > 0 ? s.rounds_won / s.rounds_played : 0,
      adr: s && s.rounds_played > 0 ? s.total_damage / s.rounds_played : 0,
    });
  }

  // Sort: later eliminated = better (lower rank number), then wins desc, then RWR% desc, then ADR desc.
  eliminated.sort((a, b) => b.lastRound - a.lastRound || b.wins - a.wins || b.rwr - a.rwr || b.adr - a.adr);

  const nextRank = finalPlayers.length + 1;
  eliminated.forEach((p, i) => rankMap.set(p.player_id, nextRank + i));

  return rankMap;
}

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

// ─── H2H aggregation ─────────────────────────────────────────────────────────
//
// Pure duo/rival aggregation core, shared by `getH2HData` (queries.ts, DB-backed —
// used where no live season filter needs to react client-side) and the Statistics
// / Map pages (which already hold full `MapMatchRow[]` client-side for their other
// tabs and compute H2H straight from it so the H2H tab honors the same season
// filter). Lives here instead of queries.ts so it stays importable from client
// components without pulling in the supabase client.

/** One match `playerA`+`playerB` played as partners (same faction). */
export interface DuoMatchSummary {
  matchId: number;
  seasonNumber: number | null;
  isGauntlet: boolean;
  weekNumber: number;
  matchNumber: number;
  map: string | null;
  pickedBy: 'SHIRTS' | 'SKINS' | null;
  startingSide: 'CT' | 'T' | null;
  score: { duo: number; opponents: number } | null;
  won: boolean | null;
  opponents: { player_id: number; player_name: string }[];
}

/** One match `playerA` and `playerB` met as opponents (different factions). */
export interface RivalMatchSummary {
  matchId: number;
  seasonNumber: number | null;
  isGauntlet: boolean;
  weekNumber: number;
  matchNumber: number;
  map: string | null;
  pickedBy: 'SHIRTS' | 'SKINS' | null;
  startingSide: 'CT' | 'T' | null;
  score: { a: number; b: number } | null;
  aWon: boolean | null;
  /** playerA's roster (playerA + their 2v2 teammate) for this match. */
  aTeam: MatchRosterPlayer[];
  /** playerB's roster (playerB + their 2v2 teammate) for this match. */
  bTeam: MatchRosterPlayer[];
}

/** A roster player's stat line for a single match — mirrors `MatchCardPlayer` in MatchCard.tsx. */
export interface MatchRosterPlayer {
  player_id: number;
  player_name: string;
  kills: number;
  assists: number;
  deaths: number;
  adr: number;
}

/** A pair's aggregated record on a single map, across every meeting on it. */
export interface H2HMapStat {
  map: string;
  games: number;
  /** duo: wins as a pair | rival: playerA's wins on this map */
  wins: number;
  losses: number;
  roundsWon: number;
  roundsPlayed: number;
  /** duo: combined ADR (both players) | rival: playerA's ADR */
  aAdr: number;
  /** duo: unused (0) | rival: playerB's ADR */
  bAdr: number;
}

export interface DuoStats {
  playerA: number;
  playerB: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  combinedAdr: number;
  combinedKills: number;
  combinedAssists: number;
  combinedDeaths: number;
  roundsWon: number;
  roundsPlayed: number;
  aStats: H2HPlayerStats;
  bStats: H2HPlayerStats;
  bestMap: string | null;
  mapBreakdown: H2HMapStat[];
  matches: DuoMatchSummary[];
}

/** A player's aggregated performance across their meetings with a given rival. */
export interface H2HPlayerStats {
  kills: number;
  assists: number;
  deaths: number;
  adr: number;
  rwr: number;
  roundsWon: number;
  roundsPlayed: number;
}

export interface H2HStats {
  playerA: number;
  playerB: number;
  meetings: number;
  aWins: number;
  bWins: number;
  lastMap: string | null;
  aStats: H2HPlayerStats;
  bStats: H2HPlayerStats;
  mapBreakdown: H2HMapStat[];
  matches: RivalMatchSummary[];
}

export interface H2HData {
  duos: DuoStats[];
  rivals: H2HStats[];
  players: { id: number; name: string; steam_avatar_url: string | null }[];
}

/** One match's roster, in the shape `computeH2H` needs — a flattened `player_match_stats` row. */
export interface H2HRosterRow {
  player_id: number;
  faction: 'SHIRTS' | 'SKINS';
  kills: number;
  assists: number;
  deaths: number;
  adr: number;
  is_win: boolean;
  rounds_won: number;
  rounds_played: number;
}

/** One played match, resolved to the fields `computeH2H` needs to aggregate and label it. */
export interface H2HMatchInput {
  matchId: number;
  weekNumber: number;
  matchNumber: number;
  seasonNumber: number | null;
  isGauntlet: boolean;
  map: string | null;
  /** Who picked the played map — see "Who picked" in docs/glossary.md. `null` for gauntlet matches (no veto data). */
  pickedBy: 'SHIRTS' | 'SKINS' | null;
  /** Skins' starting side for the played map. `null` for gauntlet matches (no veto data). */
  startingSide: 'CT' | 'T' | null;
  finalScore: string | null;
  roster: H2HRosterRow[];
}

function h2hPairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

interface H2HRivalPlayerAgg {
  games: number;
  kills: number;
  assists: number;
  deaths: number;
  adrSum: number;
  roundsWon: number;
  roundsPlayed: number;
}

function emptyH2HRivalPlayerAgg(): H2HRivalPlayerAgg {
  return { games: 0, kills: 0, assists: 0, deaths: 0, adrSum: 0, roundsWon: 0, roundsPlayed: 0 };
}

function finalizeH2HPlayerStats(agg: H2HRivalPlayerAgg): H2HPlayerStats {
  return {
    kills: agg.kills,
    assists: agg.assists,
    deaths: agg.deaths,
    adr: agg.games > 0 ? agg.adrSum / agg.games : 0,
    rwr: agg.roundsPlayed > 0 ? (agg.roundsWon / agg.roundsPlayed) * 100 : 0,
    roundsWon: agg.roundsWon,
    roundsPlayed: agg.roundsPlayed,
  };
}

interface H2HMapAgg {
  games: number;
  wins: number;
  losses: number;
  roundsWon: number;
  roundsPlayed: number;
  aAdrSum: number;
  bAdrSum: number;
}

function emptyH2HMapAgg(): H2HMapAgg {
  return { games: 0, wins: 0, losses: 0, roundsWon: 0, roundsPlayed: 0, aAdrSum: 0, bAdrSum: 0 };
}

/** Finalizes a per-map aggregation map into a `games`-descending list. */
function finalizeMapBreakdown(mapTotals: Map<string, H2HMapAgg>): H2HMapStat[] {
  return [...mapTotals.entries()]
    .map(([map, t]) => ({
      map,
      games: t.games,
      wins: t.wins,
      losses: t.losses,
      roundsWon: t.roundsWon,
      roundsPlayed: t.roundsPlayed,
      aAdr: t.games > 0 ? t.aAdrSum / t.games : 0,
      bAdr: t.games > 0 ? t.bAdrSum / t.games : 0,
    }))
    .sort((x, y) => y.games - x.games);
}

interface H2HDuoAgg {
  a: number;
  b: number;
  games: number;
  wins: number;
  losses: number;
  adrSum: number;
  kills: number;
  assists: number;
  deaths: number;
  roundsWon: number;
  roundsPlayed: number;
  aStats: H2HRivalPlayerAgg;
  bStats: H2HRivalPlayerAgg;
  mapTotals: Map<string, H2HMapAgg>;
  matches: DuoMatchSummary[];
}

interface H2HRivalAgg {
  a: number;
  b: number;
  meetings: number;
  aWins: number;
  bWins: number;
  aStats: H2HRivalPlayerAgg;
  bStats: H2HRivalPlayerAgg;
  mapTotals: Map<string, H2HMapAgg>;
  matches: RivalMatchSummary[];
}

/**
 * The map a duo has won together most often. If multiple maps are tied for
 * the most wins, there's no clear "best" — return null rather than picking
 * one arbitrarily.
 */
function bestH2HMapFor(mapTotals: Map<string, { games: number; wins: number }>): string | null {
  let bestMap: string | null = null;
  let bestWins = -1;
  let tied = false;
  for (const [map, t] of mapTotals) {
    if (t.wins > bestWins) {
      bestMap = map;
      bestWins = t.wins;
      tied = false;
    } else if (t.wins === bestWins) {
      tied = true;
    }
  }
  return tied ? null : bestMap;
}

/**
 * Computes head-to-head relationship data — partner records (`duos`) and
 * opponent records (`rivals`) — from a set of already-resolved played matches.
 * Only played matches should be passed in (callers filter with `isPlayedScore`
 * beforehand, since what counts as "played" and which seasons are in scope
 * varies by caller).
 */
export function computeH2H(
  matches: H2HMatchInput[],
  players: Map<number, { name: string; steam_avatar_url: string | null }>,
): H2HData {
  const duoAgg = new Map<string, H2HDuoAgg>();
  const rivalAgg = new Map<string, H2HRivalAgg>();
  const playerIds = new Set<number>();

  function getDuo(x: H2HRosterRow, y: H2HRosterRow): H2HDuoAgg {
    const [a, b] = x.player_id < y.player_id ? [x.player_id, y.player_id] : [y.player_id, x.player_id];
    const key = h2hPairKey(a, b);
    let agg = duoAgg.get(key);
    if (!agg) {
      agg = { a, b, games: 0, wins: 0, losses: 0, adrSum: 0, kills: 0, assists: 0, deaths: 0, roundsWon: 0, roundsPlayed: 0, aStats: emptyH2HRivalPlayerAgg(), bStats: emptyH2HRivalPlayerAgg(), mapTotals: new Map(), matches: [] };
      duoAgg.set(key, agg);
    }
    return agg;
  }

  function getRival(x: H2HRosterRow, y: H2HRosterRow): H2HRivalAgg {
    const [a, b] = x.player_id < y.player_id ? [x.player_id, y.player_id] : [y.player_id, x.player_id];
    const key = h2hPairKey(a, b);
    let agg = rivalAgg.get(key);
    if (!agg) {
      agg = { a, b, meetings: 0, aWins: 0, bWins: 0, aStats: emptyH2HRivalPlayerAgg(), bStats: emptyH2HRivalPlayerAgg(), mapTotals: new Map(), matches: [] };
      rivalAgg.set(key, agg);
    }
    return agg;
  }

  for (const m of matches) {
    const roster = m.roster;
    if (roster.length === 0) continue;
    for (const r of roster) playerIds.add(r.player_id);

    // Partner/opponent grouping is purely faction-based: two players are
    // partners if they share a `faction` (SHIRTS/SKINS) in a match, opponents
    // if they don't. There's no explicit "duo"/"team" entity in the schema —
    // this only produces correct results because the format is always 2v2
    // Wingman. Revisit if the format ever changes.
    const shirts = roster.filter((r) => r.faction === 'SHIRTS');
    const skins = roster.filter((r) => r.faction === 'SKINS');
    const parsedScore = parseScore(m.finalScore);
    const playedMap = m.map;

    const teams = [
      { roster: shirts, opponents: skins, ourScore: parsedScore?.shirts ?? null, theirScore: parsedScore?.skins ?? null },
      { roster: skins, opponents: shirts, ourScore: parsedScore?.skins ?? null, theirScore: parsedScore?.shirts ?? null },
    ];
    for (const { roster: team, opponents, ourScore, theirScore } of teams) {
      for (let i = 0; i < team.length; i++) {
        for (let j = i + 1; j < team.length; j++) {
          const x = team[i];
          const y = team[j];
          const agg = getDuo(x, y);
          agg.games += 1;
          if (x.is_win) agg.wins += 1;
          else agg.losses += 1;
          agg.adrSum += x.adr + y.adr;
          agg.kills += x.kills + y.kills;
          agg.assists += (x.assists ?? 0) + (y.assists ?? 0);
          agg.deaths += x.deaths + y.deaths;
          // x and y are teammates, so they share identical round totals for this match — count once.
          agg.roundsWon += x.rounds_won;
          agg.roundsPlayed += x.rounds_played;
          // Per-player stats: aStats belongs to the lower-id player (agg.a), bStats to the higher.
          const aRow = x.player_id === agg.a ? x : y;
          const bRow = aRow === x ? y : x;
          for (const [statAgg, row] of [[agg.aStats, aRow], [agg.bStats, bRow]] as const) {
            statAgg.games += 1;
            statAgg.kills += row.kills;
            statAgg.assists += row.assists ?? 0;
            statAgg.deaths += row.deaths;
            statAgg.adrSum += row.adr;
            statAgg.roundsWon += row.rounds_won;
            statAgg.roundsPlayed += row.rounds_played;
          }
          if (playedMap) {
            const mapKey = playedMap.toLowerCase();
            const mapAgg = agg.mapTotals.get(mapKey) ?? emptyH2HMapAgg();
            mapAgg.games += 1;
            if (x.is_win) mapAgg.wins += 1;
            else mapAgg.losses += 1;
            mapAgg.roundsWon += x.rounds_won;
            mapAgg.roundsPlayed += x.rounds_played;
            mapAgg.aAdrSum += x.adr + y.adr;
            agg.mapTotals.set(mapKey, mapAgg);
          }
          agg.matches.push({
            matchId: m.matchId,
            seasonNumber: m.seasonNumber,
            isGauntlet: m.isGauntlet,
            weekNumber: m.weekNumber,
            matchNumber: m.matchNumber,
            map: playedMap,
            pickedBy: m.pickedBy,
            startingSide: m.startingSide,
            score: ourScore != null && theirScore != null ? { duo: ourScore, opponents: theirScore } : null,
            won: x.is_win,
            opponents: opponents.map((r) => ({ player_id: r.player_id, player_name: players.get(r.player_id)?.name ?? `#${r.player_id}` })),
          });
        }
      }
    }

    for (const x of shirts) {
      for (const y of skins) {
        const agg = getRival(x, y);
        agg.meetings += 1;
        const aRow = x.player_id === agg.a ? x : y;
        const bRow = aRow === x ? y : x;
        if (aRow.is_win) agg.aWins += 1;
        else agg.bWins += 1;

        for (const [statAgg, row] of [[agg.aStats, aRow], [agg.bStats, bRow]] as const) {
          statAgg.games += 1;
          statAgg.kills += row.kills;
          statAgg.assists += row.assists ?? 0;
          statAgg.deaths += row.deaths;
          statAgg.adrSum += row.adr;
          statAgg.roundsWon += row.rounds_won;
          statAgg.roundsPlayed += row.rounds_played;
        }

        if (playedMap) {
          const mapKey = playedMap.toLowerCase();
          const mapAgg = agg.mapTotals.get(mapKey) ?? emptyH2HMapAgg();
          mapAgg.games += 1;
          if (aRow.is_win) mapAgg.wins += 1;
          else mapAgg.losses += 1;
          mapAgg.roundsWon += aRow.rounds_won;
          mapAgg.roundsPlayed += aRow.rounds_played;
          mapAgg.aAdrSum += aRow.adr;
          mapAgg.bAdrSum += bRow.adr;
          agg.mapTotals.set(mapKey, mapAgg);
        }

        const aScore = parsedScore ? (aRow.faction === 'SHIRTS' ? parsedScore.shirts : parsedScore.skins) : null;
        const bScore = parsedScore ? (bRow.faction === 'SHIRTS' ? parsedScore.shirts : parsedScore.skins) : null;
        const toRosterPlayer = (row: H2HRosterRow): MatchRosterPlayer => ({
          player_id: row.player_id,
          player_name: players.get(row.player_id)?.name ?? `#${row.player_id}`,
          kills: row.kills,
          assists: row.assists ?? 0,
          deaths: row.deaths,
          adr: row.adr,
        });
        // 2v2 Wingman, so each side's full roster is just the shirts/skins group aRow/bRow belongs to.
        agg.matches.push({
          matchId: m.matchId,
          seasonNumber: m.seasonNumber,
          isGauntlet: m.isGauntlet,
          weekNumber: m.weekNumber,
          matchNumber: m.matchNumber,
          map: playedMap,
          pickedBy: m.pickedBy,
          startingSide: m.startingSide,
          score: aScore != null && bScore != null ? { a: aScore, b: bScore } : null,
          aWon: aRow.is_win,
          aTeam: (aRow.faction === 'SHIRTS' ? shirts : skins).map(toRosterPlayer),
          bTeam: (bRow.faction === 'SHIRTS' ? shirts : skins).map(toRosterPlayer),
        });
      }
    }
  }

  const duos: DuoStats[] = [...duoAgg.values()].map((d) => ({
    playerA: d.a,
    playerB: d.b,
    gamesPlayed: d.games,
    wins: d.wins,
    losses: d.losses,
    combinedAdr: d.games > 0 ? d.adrSum / d.games : 0,
    combinedKills: d.kills,
    combinedAssists: d.assists,
    combinedDeaths: d.deaths,
    roundsWon: d.roundsWon,
    roundsPlayed: d.roundsPlayed,
    aStats: finalizeH2HPlayerStats(d.aStats),
    bStats: finalizeH2HPlayerStats(d.bStats),
    bestMap: bestH2HMapFor(d.mapTotals),
    mapBreakdown: finalizeMapBreakdown(d.mapTotals),
    matches: [...d.matches].sort(compareMatchRefDesc), // most recent first
  }));

  const rivals: H2HStats[] = [...rivalAgg.values()].map((r) => {
    const sortedMatches = [...r.matches].sort(compareMatchRefDesc); // most recent first
    return {
      playerA: r.a,
      playerB: r.b,
      meetings: r.meetings,
      aWins: r.aWins,
      bWins: r.bWins,
      lastMap: sortedMatches[0]?.map ?? null,
      aStats: finalizeH2HPlayerStats(r.aStats),
      bStats: finalizeH2HPlayerStats(r.bStats),
      mapBreakdown: finalizeMapBreakdown(r.mapTotals),
      matches: sortedMatches,
    };
  });

  const playerList = [...playerIds]
    .map((id) => ({
      id,
      name: players.get(id)?.name ?? `#${id}`,
      steam_avatar_url: players.get(id)?.steam_avatar_url ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { duos, rivals, players: playerList };
}

// Minimal shape for `mapMatchRowsToH2HInput` — mirrors `MapMatchRow`/`MapPlayerStat`
// from queries.ts without importing them, so this file stays supabase-free.
interface _H2HSourceStat {
  player_id: number;
  faction: 'SHIRTS' | 'SKINS';
  kills: number;
  assists: number;
  deaths: number;
  adr: number;
  rounds_played: number;
  rounds_won: number;
  is_win: boolean;
}
interface _H2HSourceMatch {
  match_id: number;
  match_number: number;
  week_number: number;
  season_number: number | null;
  is_gauntlet: boolean;
  final_score: string | null;
  picked_map: string | null;
  shirts_pick: string | null;
  skins_starting_side: 'CT' | 'T' | null;
  shirts_stats: _H2HSourceStat[];
  skins_stats: _H2HSourceStat[];
}

/**
 * Who picked the played map — see "Who picked" in docs/glossary.md. `shirts_pick`
 * set means shirts picked; otherwise `picked_map` set means skins picked; neither
 * set (e.g. gauntlet matches, which have no veto data) means unknown.
 */
export function resolveH2HPickedBy(shirtsPick: string | null, pickedMap: string | null): 'SHIRTS' | 'SKINS' | null {
  if (shirtsPick != null) return 'SHIRTS';
  if (pickedMap != null) return 'SKINS';
  return null;
}

/**
 * Adapts already-fetched match rows (`MapMatchRow[]` in queries.ts — used by the
 * Statistics and Map pages, which load full match history client-side for their
 * other tabs) into `computeH2H`'s input shape. Callers should pass already
 * played+filtered matches (see `isPlayedScore`, and each page's own season filter).
 */
export function mapMatchRowsToH2HInput(matches: _H2HSourceMatch[]): H2HMatchInput[] {
  return matches.map((m) => ({
    matchId: m.match_id,
    weekNumber: m.week_number,
    matchNumber: m.match_number,
    seasonNumber: m.season_number,
    isGauntlet: m.is_gauntlet,
    // Some seasons recorded the played map under `shirts_pick` rather than
    // `picked_map` — same fallback used throughout the codebase (see
    // `getMatchById`, `getCareerMatchHistory`, `getH2HData`).
    map: m.shirts_pick ?? m.picked_map,
    pickedBy: resolveH2HPickedBy(m.shirts_pick, m.picked_map),
    startingSide: m.skins_starting_side,
    finalScore: m.final_score,
    roster: [...m.shirts_stats, ...m.skins_stats],
  }));
}
