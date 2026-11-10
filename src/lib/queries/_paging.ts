// Paging for Supabase reads. No imports, so code outside `queries/` (route handlers, scripts, the
// test setup) can page a read without pulling in `_shared.ts`'s dependencies.

/** PostgREST's default response cap: a select returning more rows than this is cut off without an
 *  error. */
const SUPABASE_PAGE_SIZE = 1000;

let pageSize = SUPABASE_PAGE_SIZE;

/** Test-only: pages `fetchAllPages()` in `n`-row windows (pass `undefined` to restore the default),
 *  so a small fixture crosses page boundaries. `test-support/setupPaging.ts` sets it for every
 *  test, together with the fake client's matching row cap. */
export function __setPageSizeForTests(n: number | undefined): void {
  pageSize = n ?? SUPABASE_PAGE_SIZE;
}

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
 *
 * The query must `.order()` by a unique key (`id`, or a column list ending in one) before its
 * `.range()`. Without one Postgres may return rows in a different order for each page, so a row
 * can appear on two pages or on none. The fake client (`test-support/fakeSupabase.ts`) rejects a
 * `.range()` with no `.order()`.
 */
export async function fetchAllPages<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const results: T[] = [];
  let from = 0;
  for (;;) {
    const size = pageSize;
    const { data, error } = await buildQuery(from, from + size - 1);
    if (error) throw error;
    const page = data ?? [];
    results.push(...page);
    if (page.length < size) break;
    from += size;
  }
  return results;
}
