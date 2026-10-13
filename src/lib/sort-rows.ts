export type SortValue = number | string | null;

/**
 * `rows` ordered by the column named in `sort` (`keys` maps a column to the value it sorts by). An
 * unknown column — or none — leaves the incoming order. `null` values always sort last, and rows that
 * tie keep their incoming order whichever way the column runs, so a table opened in its canonical
 * ranking order stays stable under re-sorting.
 */
export function sortRows<T>(
  rows: T[],
  sort: { col: string; asc: boolean },
  keys: Record<string, (row: T) => SortValue>,
): T[] {
  const valueOf = keys[sort.col];
  if (!valueOf) return rows;
  const dir = sort.asc ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: valueOf(row) }))
    .sort((a, b) => {
      if (a.v === b.v) return a.i - b.i;
      if (a.v == null) return 1;
      if (b.v == null) return -1;
      const cmp = typeof a.v === 'string' ? a.v.localeCompare(b.v as string) : a.v - (b.v as number);
      return cmp === 0 ? a.i - b.i : cmp * dir;
    })
    .map((x) => x.row);
}
