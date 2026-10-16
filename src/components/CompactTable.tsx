import Link from 'next/link';
import { TH_ALIGN_CLS } from './Th';
import type { ThAlign } from './Th';

// The compact table that sits inside a card (the player page's trophy stat strip, a matchup's
// per-map breakdown). It is its own set of pieces rather than a mode of the stat-table ones: no
// frame, no header band, a small uppercase label above 11px figures with 4px of vertical padding.
// See "Compact tables inside cards" in docs/visual-conventions.md.

/** The table element. With `widths` (one Tailwind width class per column) it is a fixed layout that
 *  keeps those widths and shrinks to them; without, it fills its container. */
export function CompactTable({ widths, children }: { widths?: string[]; children: React.ReactNode }) {
  return (
    <table className={`border-collapse ${widths ? 'table-fixed shrink-0' : 'w-full'}`}>
      {widths && (
        <colgroup>
          {widths.map((w, i) => <col key={i} className={w} />)}
        </colgroup>
      )}
      {children}
    </table>
  );
}

/** A header cell: the small uppercase label, no band and no rule. */
export function CompactTh({
  children,
  align = 'left',
  title,
}: {
  children: React.ReactNode;
  align?: ThAlign;
  title?: string;
}) {
  return (
    <th
      title={title}
      className={`tracked text-[9px] font-semibold leading-normal px-2 pb-1 whitespace-nowrap text-[var(--color-text-secondary)] ${TH_ALIGN_CLS[align]}`}
    >
      {children}
    </th>
  );
}

/** A body row, divided from the one above by a tertiary rule. */
export function CompactTr({ children }: { children: React.ReactNode }) {
  return <tr className="border-t border-[var(--color-border-tertiary)]">{children}</tr>;
}

/** A figure cell: mono 11px with tabular digits, right-aligned unless told otherwise. */
export function CompactTd({
  align = 'right',
  bold = false,
  children,
}: {
  align?: ThAlign;
  bold?: boolean;
  children: React.ReactNode;
}) {
  return (
    <td className={`px-2 py-1 font-mono text-[11px] tnum ${TH_ALIGN_CLS[align]} ${bold ? 'font-semibold' : ''}`}>
      {children}
    </td>
  );
}

/** A name cell linking to `href`: display font, 11px semibold, truncating. */
export function CompactNameTd({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <td className="px-2 py-1 font-display text-[11px] font-semibold truncate">
      <Link href={href} className="hover:underline capitalize">{children}</Link>
    </td>
  );
}
