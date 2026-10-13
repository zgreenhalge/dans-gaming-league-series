'use client';

import type { SortState } from './useSortState';

/** Clickable column header in `Th`'s style, with an arrow on the active column. The `button` keeps it
 *  keyboard-reachable; `aria-sort` tells assistive tech which column orders the table. */
export default function SortableTh({
  label,
  title,
  sortKey,
  state,
  onSort,
  align = 'left',
}: {
  label: string;
  title?: string;
  sortKey: string;
  state: SortState;
  onSort: (key: string) => void;
  align?: 'left' | 'right';
}) {
  const active = state.col === sortKey;
  return (
    <th
      aria-sort={active ? (state.asc ? 'ascending' : 'descending') : 'none'}
      className={`border-b border-[var(--color-border-primary)] p-0 ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <button
        type="button"
        title={title}
        onClick={() => onSort(sortKey)}
        className={`tracked w-full cursor-pointer select-none whitespace-nowrap px-3 py-2 text-[9px] font-semibold hover:bg-[var(--color-bg-hover)] ${
          align === 'right' ? 'text-right' : 'text-left'
        } ${active ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}
      >
        {label}
        {active ? (state.asc ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  );
}
