import { useState } from 'react';

export interface SortState {
  col: string;
  asc: boolean;
}

/**
 * Column-sort state for a table: which column, which direction. Clicking a new column sorts it
 * descending (the usual stat-table first click), clicking the active one flips it. `ascFirst` names
 * columns whose first click should be ascending instead (a name, a rank). A `defaultCol` that names
 * no column (`''`) starts the table unsorted, in its incoming order.
 */
export function useSortState(
  defaultCol: string,
  opts: { ascFirst?: readonly string[] } = {},
): [SortState, (col: string) => void] {
  const { ascFirst = [] } = opts;
  const [sort, setSort] = useState<SortState>({ col: defaultCol, asc: false });
  const toggle = (col: string) =>
    setSort((s) => (s.col === col ? { col, asc: !s.asc } : { col, asc: ascFirst.includes(col) }));
  return [sort, toggle];
}
