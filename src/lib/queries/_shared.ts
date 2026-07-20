import { gunzipMaybe } from '../gzip';
import { getR2Object } from '../r2';

const SUPABASE_PAGE_SIZE = 1000;

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
