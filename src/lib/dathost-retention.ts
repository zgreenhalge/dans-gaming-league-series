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

const DEMO_PATH_RE = /^MatchZy\/(.+)\.dem$/;

/** A current-format demo's match id, via `matchIdFromDemoBaseName()` (`./matchzy.ts`) — the same
 *  function `demoBaseName()` has as its own inverse, so this can't independently drift out of sync
 *  with whatever `demoBaseName()` actually produces the way a hand-maintained regex could. */
function demoBaseNameMatcher(path: string): number | null {
  const m = DEMO_PATH_RE.exec(path);
  return m ? matchIdFromDemoBaseName(m[1]) : null;
}

/** Group every match-scoped file by the match id embedded in its path, by known MatchZy pattern.
 *  The two legacy demo matchers only cover residue predating `demoBaseName()`: DatHost's own
 *  auto-generated `date_HH-MM-SS_matchId_map.dem` naming (before `matchzy_demo_name_format` pinned
 *  the current scheme), and an even older bare `matchId.dem`. */
export function groupByMatchId(files: RemoteFile[]): Map<number, RemoteFile[]> {
  const matchers: Matcher[] = [
    fromRegex(/^matchzy_(\d+)_\d+_round\d+\.txt$/),
    fromRegex(/^MatchZyDataBackup\/matchzy_(\d+)_\d+_round\d+\.json$/),
    fromRegex(/^MatchZy_Stats\/(\d+)\//),
    fromRegex(/^MatchZyPlayerNames\/Match_(\d+)\.ini$/),
    demoBaseNameMatcher,
    fromRegex(/^MatchZy\/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_(\d+)_.*\.dem$/),
    fromRegex(/^MatchZy\/(\d+)\.dem$/),
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
