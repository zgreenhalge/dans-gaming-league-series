// Shared static (non-sortable) stat-table header cell — the plain-text sibling of a sortable
// header (e.g. BasicStatsView's own `SortableTh`), for tables whose columns aren't sortable or
// whose leading label column never is. Mirrors `tabCls()`'s pattern: a small typed helper for a
// class string that was independently hand-rolled at every call site.

export default function Th({
  children,
  align = 'left',
  className = '',
}: {
  children: React.ReactNode;
  /** Text alignment — left for a row's label column, right for numeric columns. */
  align?: 'left' | 'right';
  /** Extra classes merged onto the cell. */
  className?: string;
}) {
  return (
    <th
      className={`tracked text-[9px] font-semibold py-2 px-3 border-b border-[var(--color-border-primary)] text-[var(--color-text-secondary)] ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${className}`}
    >
      {children}
    </th>
  );
}
