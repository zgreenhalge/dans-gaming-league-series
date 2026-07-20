
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
