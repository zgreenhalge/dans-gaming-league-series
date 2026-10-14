// The shared stat-table header cell. `Th` is the plain (non-sortable) one; `SortableTh` (its own
// file) is the clickable one, and the two read identically side by side: 10px semibold, letter-
// spaced but not uppercased, 10px padding on every side, on a tinted header band with a bottom
// rule. A table puts them in its header row and passes `sticky` on the first (name) cell to pin it
// while the rest scrolls sideways.

/** Typography, tint and rule shared by `Th` and `SortableTh`. */
export const TH_CLS =
  'bg-[var(--color-bg-secondary)] border-b border-[var(--color-border-primary)] text-[10px] font-semibold tracking-[var(--tracking-label)]';

/** Text alignment — left for a row's label column, right for numeric columns, center for a badge. */
export type ThAlign = 'left' | 'right' | 'center';

export const TH_ALIGN_CLS: Record<ThAlign, string> = { left: 'text-left', right: 'text-right', center: 'text-center' };

export default function Th({
  children,
  align = 'left',
  sticky = false,
  title,
  className = '',
}: {
  children?: React.ReactNode;
  align?: ThAlign;
  /** Pin the cell to the left edge while the table scrolls horizontally (`.sticky-col`). */
  sticky?: boolean;
  title?: string;
  /** Extra classes merged onto the cell, e.g. a width. */
  className?: string;
}) {
  return (
    <th
      title={title}
      className={`${TH_CLS} ${TH_ALIGN_CLS[align]} p-2.5 whitespace-nowrap text-[var(--color-text-secondary)] ${sticky ? 'sticky-col' : ''} ${className}`}
    >
      {children}
    </th>
  );
}
