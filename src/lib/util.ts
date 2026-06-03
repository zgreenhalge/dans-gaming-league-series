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

/** Shared tab button class — matches the bordered-underline tab pattern used throughout the app. */
export function tabCls(active: boolean): string {
  return [
    'px-4 py-2 tracked text-[11px] font-semibold border-b-2 transition-colors',
    active
      ? 'border-[var(--color-text-primary)] text-[var(--color-text-primary)]'
      : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
  ].join(' ');
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
