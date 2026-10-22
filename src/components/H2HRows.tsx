import Link from 'next/link';
import { duoAvgKda, MIN_GAMES_FOR_PERFORMANCE, unevenRivalryNote, type DuoStats, type H2HStats } from '@/lib/h2h';
import { formatSigned, signedColor, winRatePct } from '@/lib/util';
import PlayerAvatar from './PlayerAvatar';
import RatingCircle from './RatingCircle';

// The ranked-pair rows of `H2HSection`'s Best Friends / Closest Rivals cards, shared with the home
// page's Top duos / Hottest Rivalries so the two read the same. A row is either a link (`href`, the
// home page) or a button-like row that selects the pair (`onSelect` / `onHover`, `H2HSection`).
// `compact` drops what doesn't fit a narrow card — a duo's rounds column and a rivalry's avatars.

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

// The full table drops its KDA and Rounds W-L columns below `sm`, where a card has no room for them
// beside the avatars and names; the header and every row apply the same template so their columns
// line up.
function duoCols(compact: boolean): string {
  return compact ? 'grid-cols-[32px_44px_40px]' : 'grid-cols-[32px_34px_40px_40px] sm:grid-cols-[32px_34px_40px_40px_32px_58px]';
}

/** Column labels above a list of `DuoRow`s. */
export function DuoHeader({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center px-3.5 pt-2">
      <span className="flex-1" />
      <div className={`grid ${duoCols(compact)} gap-x-2 shrink-0`}>
        <span className={`${HEAD_CLS} text-center`}>Rating</span>
        {!compact && <span className={`${HEAD_CLS} text-right`}>Games</span>}
        <span className={`${HEAD_CLS} text-right`}>W-L</span>
        <span className={`${HEAD_CLS} text-right whitespace-nowrap`} title={`Wins above the pre-match odds: the duo's wins minus the wins the odds predicted. Dimmed under ${MIN_GAMES_FOR_PERFORMANCE} games together.`}>
          vs Odds
        </span>
        {!compact && (
          <>
            <span className={`${HEAD_CLS} text-right hidden sm:block`} title="Average of the two players' KDA, (kills + assists) / deaths, together. Shown for context; the Friends Rating's performance term uses ADR, not KDA.">
              KDA
            </span>
            <span className={`${HEAD_CLS} text-right whitespace-nowrap hidden sm:block`}>Rounds W-L</span>
          </>
        )}
      </div>
    </div>
  );
}

/** A ranked duo: place, both avatars, "A & B", then rating, W-L (with win rate), wins above the odds
 *  and — unless `compact` — games, the pair's average KDA (`duoAvgKda()`) and rounds W-L (with round
 *  win rate). The KDA is context only; the Friends Rating's performance term uses ADR. */
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
  const thinSample = duo.gamesPlayed < MIN_GAMES_FOR_PERFORMANCE;
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
          <RatingCircle value={rating} colorStart="white" colorEnd="var(--color-accent-green-fill)" size="xs" title={compact ? breakdown : `${breakdown} · KDA is shown for context only`} />
        </div>
        {!compact && (
          <div className="flex flex-col items-end">
            <span className="display-numeral text-[13px] text-right">{duo.gamesPlayed}</span>
            <span className="font-mono text-[8px] text-right">&nbsp;</span>
          </div>
        )}
        <div className="flex flex-col items-end">
          <span className="display-numeral text-[13px] text-right">{duo.wins}–{duo.gamesPlayed - duo.wins}</span>
          <span className="font-mono text-[8px] text-[var(--color-text-secondary)] text-right">{wr}%</span>
        </div>
        <div
          className={`flex flex-col items-end${thinSample ? ' opacity-50' : ''}`}
          title={thinSample ? `Only ${duo.gamesPlayed} ${duo.gamesPlayed === 1 ? 'game' : 'games'} together, so this is mostly noise` : undefined}
        >
          <span className="display-numeral text-[13px] text-right" style={{ color: signedColor(duo.winsAboveExpected, 1) }}>{formatSigned(duo.winsAboveExpected, 1)}</span>
          <span className="font-mono text-[8px] text-right">&nbsp;</span>
        </div>
        {!compact && (
          <>
            <div className="hidden sm:flex flex-col items-end">
              <span className="display-numeral text-[13px] text-right">{duoAvgKda(duo).toFixed(2)}</span>
              <span className="font-mono text-[8px] text-right">&nbsp;</span>
            </div>
            <div className="hidden sm:flex flex-col items-end">
              <span className="display-numeral text-[13px] text-right">{duo.roundsWon}–{duo.roundsPlayed - duo.roundsWon}</span>
              <span className="font-mono text-[8px] text-[var(--color-text-secondary)] text-right">{rwr}%</span>
            </div>
          </>
        )}
      </div>
    </RowShell>
  );
}

const UPSETS_TITLE = 'Meetings won as the pre-match underdog';

// The full table shows Upsets and Rounds beside the matches won, and drops both below `sm`, where a
// card has no room for them beside the avatars and names; the compact table shows Upsets only.
function rivalCols(compact: boolean): string {
  return compact
    ? 'grid-cols-[1fr_32px_32px_38px_32px_32px_1fr]'
    : 'grid-cols-[28px_1fr_34px_38px_34px_1fr_28px] sm:grid-cols-[28px_1fr_36px_36px_28px_36px_28px_36px_36px_1fr_28px]';
}

/** The classes that hide a full rivalry table's Upsets and Rounds cells (and their header labels)
 *  below `sm`; the compact table has no Rounds and always shows Upsets. */
const wideOnly = (compact: boolean) => (compact ? '' : ' hidden sm:block');

/** Column labels above a list of `RivalRow`s. */
export function RivalHeader({ compact = false }: { compact?: boolean }) {
  const upsets = <span className={`${HEAD_CLS} text-center${wideOnly(compact)}`} title={UPSETS_TITLE}>Upsets</span>;
  const rounds = <span className={`${HEAD_CLS} text-center${wideOnly(compact)}`}>Rounds</span>;
  const rating = `${HEAD_CLS} text-center border-x border-[var(--color-border-tertiary)] bg-[var(--color-border-tertiary)]`;
  return (
    <div className={`grid ${rivalCols(compact)} items-center gap-2 px-3.5 pt-2`}>
      {!compact && <span />}
      <span />
      {upsets}
      {!compact && rounds}
      <span className={`${HEAD_CLS} text-center`}>Won</span>
      <span className={rating}>Rating</span>
      <span className={`${HEAD_CLS} text-center`}>Won</span>
      {!compact && rounds}
      {upsets}
      <span />
      {!compact && <span />}
    </div>
  );
}

/** A ranked rivalry: the two players on either side of upset wins, rounds won (unless `compact`),
 *  matches won and the rating. `compact` also drops the avatars. The higher figure of each pair is
 *  accented. */
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
  const dim = 'text-[var(--color-text-secondary)]';
  const accent = 'text-[var(--color-site-accent)]';
  const tone = (mine: number, theirs: number) => (mine > theirs ? ` ${accent}` : mine < theirs ? ` ${dim}` : '');
  const cell = 'display-numeral text-[12px] text-center';
  const wide = wideOnly(compact);
  return (
    <RowShell className={`grid ${rivalCols(compact)} items-center gap-2 px-3.5 py-2`} action={action}>
      {!compact && <PlayerAvatar name={a.name} imageUrl={a.steam_avatar_url} size="sm" />}
      <span className="font-display font-semibold text-[11px] truncate">{a.name}</span>
      <span className={`${cell}${wide}${tone(rival.aUpsetWins, rival.bUpsetWins)}`}>{rival.aUpsetWins}</span>
      {!compact && <span className={`${cell}${wide}${tone(rival.aStats.roundsWon, rival.bStats.roundsWon)}`}>{rival.aStats.roundsWon}</span>}
      <span className={`${cell}${tone(rival.aWins, rival.bWins)}`}>{rival.aWins}</span>
      <div className="flex items-center justify-center border-x border-[var(--color-border-tertiary)] bg-[var(--color-border-tertiary)] self-stretch -my-2">
        <RatingCircle value={rating} colorStart="black" colorEnd="var(--color-accent-red-fg)" size="xs" title={breakdown} dimmedReason={unevenRivalryNote(rival)} />
      </div>
      <span className={`${cell}${tone(rival.bWins, rival.aWins)}`}>{rival.bWins}</span>
      {!compact && <span className={`${cell}${wide}${tone(rival.bStats.roundsWon, rival.aStats.roundsWon)}`}>{rival.bStats.roundsWon}</span>}
      <span className={`${cell}${wide}${tone(rival.bUpsetWins, rival.aUpsetWins)}`}>{rival.bUpsetWins}</span>
      <span className="font-display font-semibold text-[11px] text-right truncate">{b.name}</span>
      {!compact && <PlayerAvatar name={b.name} imageUrl={b.steam_avatar_url} size="sm" />}
    </RowShell>
  );
}
