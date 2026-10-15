import Link from 'next/link';
import PlayerAvatar from './PlayerAvatar';
import type { ThAlign } from './Th';
import { TH_ALIGN_CLS } from './Th';

// The shared stat-table body: the frame, the row, the figure cell and the name cell. A table builds
// its rows from these (headers come from `Th` / `SortableTh`) so frame, dividers, type scale and
// padding are never re-typed per table. See "Tables & data display" in docs/visual-conventions.md.

/** The bordered card (page background) around a table, scrolling sideways when the columns overflow.
 *  `bare` drops the border for a table sitting flush inside a bordered container. */
export function StatTable({
  bare = false,
  tinted = false,
  className = '',
  children,
}: {
  bare?: boolean;
  /** Leave the background to `className` (a faction tint) instead of the page background. */
  tinted?: boolean;
  /** Extra classes merged onto the frame, e.g. a margin. */
  className?: string;
  /** The `<thead>` and `<tbody>`. */
  children: React.ReactNode;
}) {
  return (
    <div className={`${tinted ? '' : 'bg-[var(--color-bg-primary)]'} overflow-x-auto ${bare ? '' : 'border border-[var(--color-border-primary)]'} ${className}`}>
      <table className="w-full min-w-max border-collapse">{children}</table>
    </div>
  );
}

/** A body row: tertiary divider (none under the last row — the frame's border closes the table) on
 *  an opaque page background, which a pinned name cell inherits. `clickable` rows highlight on hover
 *  (`lift-row`); rows that aren't clickable don't. `tinted` leaves the background to `className`
 *  (still opaque, so a pinned name cell can inherit it). */
export function Tr({
  clickable = false,
  tinted = false,
  className = '',
  ...rest
}: { clickable?: boolean; tinted?: boolean } & React.ComponentPropsWithoutRef<'tr'>) {
  return (
    <tr
      {...rest}
      className={`${tinted ? '' : 'bg-[var(--color-bg-primary)]'} border-b border-[var(--color-border-tertiary)] last:border-b-0 ${clickable ? 'lift-row' : ''} ${className}`}
    />
  );
}

/** A figure cell: mono 12px with tabular digits, right-aligned unless told otherwise. `muted` greys a
 *  secondary figure; `bold` emphasises a headline one; `mono={false}` is the escape hatch for a column
 *  of text rather than figures. Extra classes and cell attributes (`title`, `style`, `colSpan`) pass
 *  through. */
export function Td({
  align = 'right',
  muted = false,
  bold = false,
  mono = true,
  className = '',
  ...rest
}: { align?: ThAlign; muted?: boolean; bold?: boolean; mono?: boolean } & React.ComponentPropsWithoutRef<'td'>) {
  return (
    <td
      {...rest}
      className={`p-2 ${mono ? 'font-mono' : ''} text-[12px] tnum ${TH_ALIGN_CLS[align]} ${muted ? 'text-[var(--color-text-secondary)]' : ''} ${bold ? 'font-semibold' : ''} ${className}`}
    />
  );
}

/** A name cell: display font, 14px semibold. `sticky` pins it while the table scrolls sideways. */
export function NameTd({
  sticky = false,
  className = '',
  ...rest
}: { sticky?: boolean } & React.ComponentPropsWithoutRef<'td'>) {
  return (
    <td
      {...rest}
      className={`p-2 font-display text-[14px] font-semibold ${sticky ? 'sticky-col' : ''} ${className}`}
    />
  );
}

/** The pinned player-name cell of a stat table, linking to the player's page. Passing `avatarUrl`
 *  (null for a player without one) puts the avatar beside the name. */
export function PlayerCell({ id, name, avatarUrl }: { id: number; name: string; avatarUrl?: string | null }) {
  return (
    <NameTd sticky>
      <Link
        href={`/players/${id}`}
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-2 w-full h-full"
      >
        {avatarUrl !== undefined && <PlayerAvatar name={name} imageUrl={avatarUrl} size="sm" />}
        <span className="truncate">{name}</span>
      </Link>
    </NameTd>
  );
}
