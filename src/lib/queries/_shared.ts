
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
 * Which of `matchIds` a map-level rollup (issue #127) doesn't cover yet, given the
 * rollup's own `matchIds` list — shared by `getMapHeatmapPoints()` and
 * `getPlayerRoundTraces()`, both of which fetch only this delta directly when a
 * rollup is missing or partial.
 */
export function missingFromRollup(matchIds: number[], rollupMatchIds: number[] | undefined): number[] {
  const covered = new Set(rollupMatchIds ?? []);
  return matchIds.filter((id) => !covered.has(id));
}
