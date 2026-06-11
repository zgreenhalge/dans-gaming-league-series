/**
 * Returns true if a `final_score` string represents a real played result.
 * Treats null and "0-0" / "0 - 0" as not yet played (S3 matches are pre-staged
 * with "0-0" placeholders before stats are entered).
 */
export function isPlayedScore(finalScore: string | null | undefined): boolean {
  if (!finalScore) return false;
  return !/^\s*0\s*[-–]\s*0\s*$/.test(finalScore);
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

export function avgOf(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
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
