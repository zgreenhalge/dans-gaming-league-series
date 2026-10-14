'use client';

import type { SortState } from './useSortState';
import { TH_ALIGN_CLS, TH_CLS, type ThAlign } from './Th';

/** Clickable column header in `Th`'s style. The `button` keeps it keyboard-reachable (with a focus
 *  ring), `aria-sort` tells assistive tech which column orders the table, and hovering tints it. The
 *  sort arrow has its slot reserved on the side away from the cell's alignment edge — before the
 *  label on a right-aligned column, after it on a left-aligned one (a centered one mirrors the slot
 *  on both sides) — so sorting never shifts the column's width or the label's alignment with the
 *  figures below it. */
export default function SortableTh<K extends string = string>({
  label,
  title,
  sortKey,
  state,
  onSort,
  align = 'left',
  sticky = false,
  className = '',
}: {
  label: React.ReactNode;
  title?: string;
  sortKey: K;
  state: SortState;
  onSort: (key: K) => void;
  align?: ThAlign;
  /** Pin the cell to the left edge while the table scrolls horizontally (`.sticky-col`). */
  sticky?: boolean;
  /** Extra classes merged onto the cell, e.g. a width. */
  className?: string;
}) {
  const active = state.col === sortKey;
  const arrow = (
    <span aria-hidden className={`inline-block w-[1.2em] text-center ${active ? '' : 'invisible'}`}>
      {state.asc ? '↑' : '↓'}
    </span>
  );
  return (
    <th
      aria-sort={active ? (state.asc ? 'ascending' : 'descending') : 'none'}
      className={`${TH_CLS} ${TH_ALIGN_CLS[align]} p-0 ${sticky ? 'sticky-col' : ''} ${className}`}
    >
      <button
        type="button"
        title={title}
        onClick={() => onSort(sortKey)}
        className={`w-full cursor-pointer select-none whitespace-nowrap p-2.5 outline-none hover:bg-[var(--color-bg-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-border-primary)] ${TH_ALIGN_CLS[align]} ${
          active ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'
        }`}
      >
        {align === 'right' && arrow}
        {align === 'center' && <span aria-hidden className="inline-block w-[1.2em]" />}
        {label}
        {align !== 'right' && arrow}
      </button>
    </th>
  );
}
