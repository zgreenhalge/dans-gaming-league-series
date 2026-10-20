import Link from 'next/link';
import type { DuoStats, H2HStats } from '@/lib/h2h';
import { winRatePct } from '@/lib/util';
import PlayerAvatar from './PlayerAvatar';
import RatingCircle from './RatingCircle';

// The ranked-pair rows of `H2HSection`'s Best Friends / Closest Rivals cards, shared with the home
// page's Top duos / Hottest Rivalries so the two read the same. A row is either a link (`href`, the
// home page) or a button-like row that selects the pair (`onSelect` / `onHover`, `H2HSection`).
// `compact` drops the columns that don't fit a narrow card — the round figures and, for a rivalry,
// the avatars.

export interface PlayerRef {
  id: number;
  name: string;
  steam_avatar_url: string | null;
}

interface RowAction {
  /** Open this URL when the row is clicked. */
  href?: string;
  /** Select the pair (`H2HSection`'s click handler). */
  onSelect?: () => void;
  /** Hover preview in/out (`H2HSection`). */
  onHover?: (on: boolean) => void;
  /** Tint the row as the currently selected pair. */
  highlight?: string;
}

const ROW_BASE = 'lift-row border-b border-[var(--color-border-tertiary)] last:border-b-0';

function RowShell({
  className,
  action,
  children,
}: {
  className: string;
  action: RowAction;
  children: React.ReactNode;
}) {
  const style = action.highlight ? { background: action.highlight } : undefined;
  if (action.href) {
    return (
      <Link href={action.href} className={`${ROW_BASE} ${className}`} style={style}>
        {children}
      </Link>
    );
  }
  return (
    <div
      className={`${ROW_BASE} ${className} cursor-pointer`}
      style={style}
      onClick={action.onSelect}
      onMouseEnter={action.onHover && (() => action.onHover!(true))}
      onMouseLeave={action.onHover && (() => action.onHover!(false))}
    >
      {children}
    </div>
  );
}

const HEAD_CLS = 'tracked text-[8px] text-[var(--color-text-secondary)]';

function duoCols(compact: boolean): string {
  return compact ? 'grid-cols-[28px_34px_44px]' : 'grid-cols-[28px_34px_44px_88px]';
}

/** Column labels above a list of `DuoRow`s. */
export function DuoHeader({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center px-3.5 pt-2">
      <span className="flex-1" />
      <div className={`grid ${duoCols(compact)} gap-x-2 shrink-0`}>
        <span className={`${HEAD_CLS} text-center`}>Rating</span>
        <span className={`${HEAD_CLS} text-right`}>Games</span>
        <span className={`${HEAD_CLS} text-right`}>W-L</span>
        {!compact && <span className={`${HEAD_CLS} text-right`}>Rounds W-L</span>}
      </div>
    </div>
  );
}

/** A ranked duo: place, both avatars, "A & B", then rating, games, W-L (with win rate) and — unless
 *  `compact` — rounds W-L (with round win rate). */
export function DuoRow({
  rank,
  duo,
  rating,
  breakdown,
  a,
  b,
  compact = false,
  ...action
}: RowAction & {
  rank: number;
  duo: DuoStats;
  rating: number;
  /** Tooltip on the rating circle (`duoBreakdownScorer()`). */
  breakdown: string;
  a: PlayerRef;
  b: PlayerRef;
  compact?: boolean;
}) {
  const wr = winRatePct(duo.wins, duo.gamesPlayed);
  const rwr = winRatePct(duo.roundsWon, duo.roundsPlayed);
  return (
    <RowShell className="flex items-center gap-2.5 px-3.5 py-2" action={action}>
      <span className="display-numeral text-[12px] w-3.5 text-[var(--color-text-secondary)]">{rank}</span>
      <div className="flex">
        <PlayerAvatar name={a.name} imageUrl={a.steam_avatar_url} size="sm" />
        <div className="-ml-1.5"><PlayerAvatar name={b.name} imageUrl={b.steam_avatar_url} size="sm" /></div>
      </div>
      <span className="font-display font-semibold text-[11px] flex-1 truncate">{a.name} &amp; {b.name}</span>
      <div className={`grid ${duoCols(compact)} gap-x-2 shrink-0 items-center`}>
        <div className="flex justify-center">
          <RatingCircle value={rating} colorStart="white" colorEnd="var(--color-accent-green-fill)" size="xs" title={breakdown} />
        </div>
        <div className="flex flex-col items-end">
          <span className="display-numeral text-[13px] text-right">{duo.gamesPlayed}</span>
          <span className="font-mono text-[8px] text-right">&nbsp;</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="display-numeral text-[13px] text-right">{duo.wins}–{duo.gamesPlayed - duo.wins}</span>
          <span className="font-mono text-[8px] text-[var(--color-text-secondary)] text-right">{wr}%</span>
        </div>
        {!compact && (
          <div className="flex flex-col items-end">
            <span className="display-numeral text-[13px] inline-block w-[58px] text-right">{duo.roundsWon}–{duo.roundsPlayed - duo.roundsWon}</span>
            <span className="font-mono text-[8px] text-[var(--color-text-secondary)] inline-block w-[58px] text-right">{rwr}%</span>
          </div>
        )}
      </div>
    </RowShell>
  );
}

function rivalCols(compact: boolean): string {
  return compact
    ? 'grid-cols-[1fr_38px_38px_38px_1fr]'
    : 'grid-cols-[28px_1fr_38px_38px_38px_38px_38px_1fr_28px]';
}

/** Column labels above a list of `RivalRow`s. */
export function RivalHeader({ compact = false }: { compact?: boolean }) {
  const rating = `${HEAD_CLS} text-center border-x border-[var(--color-border-tertiary)] bg-[var(--color-border-tertiary)]`;
  return (
    <div className={`grid ${rivalCols(compact)} items-center gap-2 px-3.5 pt-2`}>
      {!compact && <span />}
      <span />
      {!compact && <span className={`${HEAD_CLS} text-center`}>Rounds</span>}
      <span className={`${HEAD_CLS} text-center`}>Won</span>
      <span className={rating}>Rating</span>
      <span className={`${HEAD_CLS} text-center`}>Won</span>
      {!compact && <span className={`${HEAD_CLS} text-center`}>Rounds</span>}
      <span />
      {!compact && <span />}
    </div>
  );
}

/** A ranked rivalry: the two players on either side of rounds won, matches won and the rating.
 *  `compact` drops the avatars and the round figures. The higher figure of each pair is accented. */
export function RivalRow({
  rival,
  rating,
  breakdown,
  a,
  b,
  compact = false,
  ...action
}: RowAction & {
  rival: H2HStats;
  rating: number;
  /** Tooltip on the rating circle (`rivalBreakdownScorer()`). */
  breakdown: string;
  a: PlayerRef;
  b: PlayerRef;
  compact?: boolean;
}) {
  const aWinsHigher = rival.aWins > rival.bWins;
  const bWinsHigher = rival.bWins > rival.aWins;
  const aRoundsHigher = rival.aStats.roundsWon > rival.bStats.roundsWon;
  const bRoundsHigher = rival.bStats.roundsWon > rival.aStats.roundsWon;
  const dim = 'text-[var(--color-text-secondary)]';
  const accent = 'text-[var(--color-site-accent)]';
  const tone = (higher: boolean, otherHigher: boolean) => (higher ? ` ${accent}` : !otherHigher ? '' : ` ${dim}`);
  return (
    <RowShell className={`grid ${rivalCols(compact)} items-center gap-2 px-3.5 py-2`} action={action}>
      {!compact && <PlayerAvatar name={a.name} imageUrl={a.steam_avatar_url} size="sm" />}
      <span className="font-display font-semibold text-[11px] truncate">{a.name}</span>
      {!compact && (
        <span className={`display-numeral text-[12px] text-center${tone(aRoundsHigher, bRoundsHigher)}`}>{rival.aStats.roundsWon}</span>
      )}
      <span className={`display-numeral text-[12px] text-center${tone(aWinsHigher, bWinsHigher)}`}>{rival.aWins}</span>
      <div className="flex items-center justify-center border-x border-[var(--color-border-tertiary)] bg-[var(--color-border-tertiary)] self-stretch -my-2">
        <RatingCircle value={rating} colorStart="black" colorEnd="var(--color-accent-red-fg)" size="xs" title={breakdown} />
      </div>
      <span className={`display-numeral text-[12px] text-center${tone(bWinsHigher, aWinsHigher)}`}>{rival.bWins}</span>
      {!compact && (
        <span className={`display-numeral text-[12px] text-center${tone(bRoundsHigher, aRoundsHigher)}`}>{rival.bStats.roundsWon}</span>
      )}
      <span className="font-display font-semibold text-[11px] text-right truncate">{b.name}</span>
      {!compact && <PlayerAvatar name={b.name} imageUrl={b.steam_avatar_url} size="sm" />}
    </RowShell>
  );
}
