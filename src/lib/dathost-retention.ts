// Pure helpers for scripts/dathost-cleanup.ts's retention logic: matching MatchZy's on-disk
// file-naming conventions back to a DGLS match id, and measuring how old a timestamp is. No DatHost
// API or Supabase calls here — those stay in the script, which is the IO-bound orchestration layer.

import { matchIdFromDemoBaseName } from './matchzy';

export interface RemoteFile {
  path: string;
  size: number;
  modifiedAt: Date | null;
}

// DatHost's file-listing API doesn't document whether `modified_at` is Unix seconds or
// milliseconds, so it's detected by magnitude instead of assumed: seconds values are ~10 digits
// today, milliseconds ~13 — three orders of magnitude apart, unambiguous either way. Anything
// resolving before this floor is treated as unusable rather than trusted — a stray 0 or otherwise
// bad value would otherwise misread as an ancient timestamp and mark residue as maximally old,
// the one direction of error that's unsafe here (it triggers deletion instead of preventing it).
const MODIFIED_AT_FLOOR_MS = Date.UTC(2020, 0, 1);

export function parseModifiedAt(raw: number | undefined): Date | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null;
  const ms = raw > 1e12 ? raw : raw * 1000;
  return ms >= MODIFIED_AT_FLOOR_MS ? new Date(ms) : null;
}

type Matcher = (path: string) => number | null;

function fromRegex(re: RegExp): Matcher {
  return (path) => {
    const m = re.exec(path);
    return m ? Number(m[1]) : null;
  };
}

/** Every recorded demo lives at `MatchZy/<base>.dem` — the one directory/extension convention every
 *  demo matcher (current and legacy) shares, and the same one `scripts/dathost-cleanup.ts` checks
 *  before gating a demo's deletion on its R2 presence. Exported so both stay in sync. */
export const DEMO_PREFIX = 'MatchZy/';
export const DEMO_SUFFIX = '.dem';

export function isDemoPath(path: string): boolean {
  return path.startsWith(DEMO_PREFIX) && path.endsWith(DEMO_SUFFIX);
}

/** A demo path's base name (the part between `DEMO_PREFIX` and `DEMO_SUFFIX`), or `null` if `path`
 *  isn't a demo path at all. Shared by every demo matcher below so each only has to describe its own
 *  base-name shape, not repeat the directory/extension it already has in common with the others. */
function demoBase(path: string): string | null {
  return isDemoPath(path) ? path.slice(DEMO_PREFIX.length, -DEMO_SUFFIX.length) : null;
}

/** A current-format demo's match id, via `matchIdFromDemoBaseName()` (`./matchzy.ts`) — the same
 *  function `demoBaseName()` has as its own inverse, so this can't independently drift out of sync
 *  with whatever `demoBaseName()` actually produces the way a hand-maintained regex could. */
function demoBaseNameMatcher(path: string): number | null {
  const base = demoBase(path);
  return base === null ? null : matchIdFromDemoBaseName(base);
}

const LEGACY_DATHOST_AUTO_BASE_RE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_(\d+)_.*$/;
const LEGACY_BARE_ID_BASE_RE = /^(\d+)$/;

/** DatHost's own pre-`matchzy_demo_name_format` auto-naming: `date_HH-MM-SS_matchId_map.dem`. */
function legacyDatHostAutoMatcher(path: string): number | null {
  const base = demoBase(path);
  if (base === null) return null;
  const m = LEGACY_DATHOST_AUTO_BASE_RE.exec(base);
  return m ? Number(m[1]) : null;
}

/** An even older bare `matchId.dem`, predating both naming schemes above. */
function legacyBareIdMatcher(path: string): number | null {
  const base = demoBase(path);
  if (base === null) return null;
  const m = LEGACY_BARE_ID_BASE_RE.exec(base);
  return m ? Number(m[1]) : null;
}

/** Group every match-scoped file by the match id embedded in its path, by known MatchZy pattern.
 *  The two legacy demo matchers only cover residue predating `demoBaseName()`: DatHost's own
 *  auto-generated naming (before `matchzy_demo_name_format` pinned the current scheme), and an even
 *  older bare `matchId.dem`. */
export function groupByMatchId(files: RemoteFile[]): Map<number, RemoteFile[]> {
  const matchers: Matcher[] = [
    fromRegex(/^matchzy_(\d+)_\d+_round\d+\.txt$/),
    fromRegex(/^MatchZyDataBackup\/matchzy_(\d+)_\d+_round\d+\.json$/),
    fromRegex(/^MatchZy_Stats\/(\d+)\//),
    fromRegex(/^MatchZyPlayerNames\/Match_(\d+)\.ini$/),
    demoBaseNameMatcher,
    legacyDatHostAutoMatcher,
    legacyBareIdMatcher,
  ];
  const byMatch = new Map<number, RemoteFile[]>();
  for (const file of files) {
    for (const matcher of matchers) {
      const matchId = matcher(file.path);
      if (matchId === null) continue;
      if (!byMatch.has(matchId)) byMatch.set(matchId, []);
      byMatch.get(matchId)!.push(file);
      break;
    }
  }
  return byMatch;
}

/** Fractional days between `iso` and now, or `null` if `iso` is unset — unknown age, never eligible
 *  for cleanup. */
export function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

/** How long ago the most recently touched file in a match's group was written, in days — `null`
 *  if DatHost returned no timestamp for any of them. Using the newest file (not the oldest) means
 *  a match isn't treated as stale while any of its files are still being actively written. */
export function residueAgeDays(files: RemoteFile[]): number | null {
  const timestamps = files.map((f) => f.modifiedAt).filter((d): d is Date => d !== null);
  if (timestamps.length === 0) return null;
  const mostRecentMs = Math.max(...timestamps.map((d) => d.getTime()));
  return (Date.now() - mostRecentMs) / (1000 * 60 * 60 * 24);
}
