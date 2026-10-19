'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { mapSlug, toSentenceCase } from '@/lib/maps';
import PlayerAvatar from './PlayerAvatar';
import type { ThAlign } from './Th';
import { TH_ALIGN_CLS } from './Th';

// The shared stat-table body: the frame, the row, the figure cell and the name cell. A table builds
// its rows from these (headers come from `Th` / `SortableTh`) so frame, dividers, type scale and
// padding are never re-typed per table. See "Tables & data display" in docs/visual-conventions.md.

/** Set by a container that tints its tables with a faction (`faction-tint` + a side class): every
 *  `StatTable` and `Tr` inside leaves its background to the tint instead of painting the page
 *  background over it, and rows mirror the tint opaquely (`faction-tint-row`) for pinned cells. */
export const FactionTintContext = createContext(false);

/** The bordered card (page background) around a table, scrolling sideways when the columns overflow.
 *  `bare` drops the border for a table sitting flush inside a bordered container. */
export function StatTable({
  bare = false,
  tinted: tintedProp = false,
  fixed = false,
  header,
  className = '',
  children,
}: {
  bare?: boolean;
  /** Leave the background to `className` (a faction tint) instead of the page background. */
  tinted?: boolean;
  /** Equal-width columns that fit the frame (`table-fixed`) instead of sizing to their content. Name
   *  cells should `truncate`. */
  fixed?: boolean;
  /** A banner inside the frame, above the table (a map image link, a title). */
  header?: React.ReactNode;
  /** Extra classes merged onto the frame, e.g. a margin. */
  className?: string;
  /** The `<thead>` and `<tbody>`. */
  children: React.ReactNode;
}) {
  const inFactionTint = useContext(FactionTintContext);
  const tinted = tintedProp || inFactionTint;
  return (
    <div className={`${tinted ? '' : 'bg-[var(--color-bg-primary)]'} overflow-x-auto ${bare ? '' : 'border border-[var(--color-border-primary)]'} ${className}`}>
      {header}
      <table className={`w-full border-collapse ${fixed ? 'table-fixed' : ''}`}>{children}</table>
    </div>
  );
}

const TR_BASE = 'border-b border-[var(--color-border-tertiary)] last:border-b-0';
const TR_BG = {
  body: 'bg-[var(--color-bg-primary)]',
  summary: 'bg-[var(--color-bg-tertiary)]',
  marker: 'row-marker',
};

type TrProps = {
  /** Highlight on hover (`lift-row`). Implied by `href`. */
  clickable?: boolean;
  /** Leave the background to `className` (a faction tint) instead of the page background. */
  tinted?: boolean;
  /** `summary` is an averages or totals row: tertiary background (apart from the header band) under a top rule. `marker` sets a
   *  row apart inside the body (the current value among scenarios) with a light fill and white rules. */
  variant?: 'body' | 'summary' | 'marker';
  /** Tint the row with this color (a medal or zone) and use it for the hover accent. */
  accent?: string;
  /** Open this URL when the row is clicked anywhere. The row's name cell still holds the one real
   *  link (keyboard, screen readers, right-click), so figure cells stay plain `Td`s. */
  href?: string;
} & React.ComponentPropsWithoutRef<'tr'>;

/** A body row: tertiary divider (none under the last row — the frame's border closes the table) on
 *  an opaque page background, which a pinned name cell inherits. `clickable` rows highlight on hover
 *  (`lift-row`); rows that aren't clickable don't. `href` makes the whole row a link (see `LinkTr`).
 *  `tinted` leaves the background to `className` (still opaque, so a pinned name cell can inherit
 *  it); `accent` is a row tint that also colors the hover. */
export function Tr({ href, ...props }: TrProps) {
  return href ? <LinkTr href={href} {...props} /> : <PlainTr {...props} />;
}

function PlainTr({
  clickable = false,
  tinted = false,
  variant = 'body',
  accent,
  className = '',
  style,
  ...rest
}: Omit<TrProps, 'href'>) {
  const inFactionTint = useContext(FactionTintContext);
  const tint = tinted || accent !== undefined;
  const bg = tint ? '' : variant === 'body' && inFactionTint ? 'faction-tint-row' : TR_BG[variant];
  return (
    <tr
      {...rest}
      style={accent ? ({ '--lift-accent': accent, ...style } as React.CSSProperties) : style}
      className={`${bg} ${accent ? 'row-tint' : ''} ${TR_BASE} ${variant === 'summary' ? 'border-t' : ''} ${clickable ? 'lift-row' : ''} ${className}`}
    />
  );
}

/** A row that opens `href` wherever it is clicked: a plain click navigates, and Cmd/Ctrl/Shift-click
 *  or a middle click opens a new tab. Clicks that land on a link or control inside the row, or that
 *  end a text selection, are left alone. Keyboard users reach the name cell's link, and the row
 *  outlines while anything in it has focus. */
function LinkTr({ href, onClick, onAuxClick, className = '', ...rest }: TrProps & { href: string }) {
  const router = useRouter();
  const fromControl = (e: React.MouseEvent) => (e.target as HTMLElement).closest('a, button, input, select, textarea') !== null;
  return (
    <PlainTr
      {...rest}
      clickable
      className={`cursor-pointer focus-within:outline focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-[var(--color-site-accent)] ${className}`}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || fromControl(e) || window.getSelection()?.toString()) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey) window.open(href, '_blank');
        else router.push(href);
      }}
      onAuxClick={(e) => {
        onAuxClick?.(e);
        if (e.button === 1 && !fromControl(e)) window.open(href, '_blank');
      }}
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
      className={`p-2 whitespace-nowrap ${mono ? 'font-mono' : ''} text-[12px] tnum ${TH_ALIGN_CLS[align]} ${muted ? 'text-[var(--color-text-secondary)]' : ''} ${bold ? 'font-semibold' : ''} ${className}`}
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
      className={`p-2 whitespace-nowrap font-display text-[14px] font-semibold ${sticky ? 'sticky-col' : ''} ${className}`}
    />
  );
}

/** The player-name cell of a stat table, linking to the player's page and pinned while the table
 *  scrolls sideways (`sticky={false}` for a table that fits its frame). Passing `avatarUrl` (null for
 *  a player without one) puts the avatar beside the name. `onToggle` marks the row as expandable: a
 *  ▸/▾ button before the name (`expanded` says which), reachable by keyboard. */
export function PlayerCell({
  id,
  name,
  avatarUrl,
  sticky = true,
  className,
  expanded = false,
  onToggle,
}: {
  id: number;
  name: string;
  avatarUrl?: string | null;
  sticky?: boolean;
  className?: string;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const link = (
    <Link
      href={`/players/${id}`}
      onClick={(e) => e.stopPropagation()}
      className="flex items-center gap-2 w-full h-full"
    >
      {avatarUrl !== undefined && <PlayerAvatar name={name} imageUrl={avatarUrl} size="sm" />}
      <span className="truncate">{name}</span>
    </Link>
  );
  return (
    <NameTd sticky={sticky} className={className}>
      {onToggle ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${name}`}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="w-3 shrink-0 text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            {expanded ? '▾' : '▸'}
          </button>
          {link}
        </div>
      ) : link}
    </NameTd>
  );
}

/** A name cell for a map, linking to the map's page. The stored name is user-typed, so it shows in
 *  sentence case. */
export function MapCell({ map }: { map: string }) {
  return (
    <NameTd>
      <Link href={`/maps/${mapSlug(map)}`} className="hover:text-[var(--color-text-secondary)] transition-colors">
        {toSentenceCase(map)}
      </Link>
    </NameTd>
  );
}

/** The full-width panel under an expanded row. It spans every column of the table's header row, so
 *  the table never counts them by hand. Put it in a `Tr` right after the row it expands. */
export function ExpandedTd({ children }: { children: React.ReactNode }) {
  const [span, setSpan] = useState(1);
  const measure = useCallback((td: HTMLTableCellElement | null) => {
    const head = td?.closest('table')?.querySelector('thead tr');
    if (!head) return;
    setSpan(Array.from(head.children).reduce((n, c) => n + ((c as HTMLTableCellElement).colSpan || 1), 0));
  }, []);
  return (
    <td ref={measure} colSpan={span} className="p-3 bg-[var(--color-bg-secondary)]">
      {children}
    </td>
  );
}
