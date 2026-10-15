// The shared stat-table header cell. `Th` is the plain (non-sortable) one; `SortableTh` (its own
// file) is the clickable one, and the two read identically side by side: 10px semibold, letter-
// spaced but not uppercased, 8px padding on every side, on a tinted header band with a bottom
// rule. A table puts them in its header row and passes `sticky` on the first (name) cell to pin it
// while the rest scrolls sideways. `compact` is the small uppercase label of a table that sits inside
// a card (a stat strip, a per-map breakdown): no band, no rule, just the label above its figures.

/** Typography, tint and rule shared by `Th` and `SortableTh`. */
export const TH_CLS =
  'bg-[var(--color-bg-secondary)] border-b border-[var(--color-border-primary)] text-[10px] font-semibold leading-normal tracking-[var(--tracking-label)]';

/** Text alignment — left for a row's label column, right for numeric columns, center for a badge. */
export type ThAlign = 'left' | 'right' | 'center';

/** Typography and spacing of a `compact` header cell. */
const TH_COMPACT_CLS = 'tracked text-[9px] font-semibold leading-normal px-2 pb-1';

export const TH_ALIGN_CLS: Record<ThAlign, string> = { left: 'text-left', right: 'text-right', center: 'text-center' };

export default function Th({
  children,
  align = 'left',
  sticky = false,
  compact = false,
  title,
  className = '',
}: {
  children?: React.ReactNode;
  align?: ThAlign;
  /** Pin the cell to the left edge while the table scrolls horizontally (`.sticky-col`). */
  sticky?: boolean;
  /** The small unbanded label for a table inside a card. */
  compact?: boolean;
  title?: string;
  /** Extra classes merged onto the cell, e.g. a width. */
  className?: string;
}) {
  return (
    <th
      title={title}
      className={`${compact ? TH_COMPACT_CLS : `${TH_CLS} p-2`} ${TH_ALIGN_CLS[align]} whitespace-nowrap text-[var(--color-text-secondary)] ${sticky ? 'sticky-col' : ''} ${className}`}
    >
      {children}
    </th>
  );
}
