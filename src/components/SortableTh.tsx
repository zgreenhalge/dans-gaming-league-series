'use client';

import type { SortState } from './useSortState';
import { TH_ALIGN_CLS, TH_CLS, labelWords, type ThAlign } from './Th';

/** Where the label and its arrow sit in the button's flex row; the label's own wrapped lines align
 *  through the button's `text-align`. */
const JUSTIFY: Record<ThAlign, string> = { left: 'justify-start', right: 'justify-end', center: 'justify-center' };

/** Clickable column header in `Th`'s style. The `button` keeps it keyboard-reachable (with a focus
 *  ring), `aria-sort` tells assistive tech which column orders the table, and hovering tints it. The
 *  sort arrow appears after the label of the sorted column only, nudging the label aside. */
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
  const arrow = active && (
    <span aria-hidden className="ml-[0.4em] shrink-0">
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
        className={`flex w-full items-baseline ${JUSTIFY[align]} cursor-pointer select-none p-2 outline-none hover:bg-[var(--color-bg-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-border-primary)] ${TH_ALIGN_CLS[align]} ${
          active ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'
        }`}
      >
        <span>{labelWords(label)}</span>
        {arrow}
      </button>
    </th>
  );
}
