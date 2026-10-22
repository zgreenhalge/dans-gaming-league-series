import Link from 'next/link';
import type { PlayerSummary } from '@/lib/queries';
import EhogBadge from './EhogBadge';
import PlayerAvatar from './PlayerAvatar';
import { PlayerName } from './PlayerName';
import StatTileGrid from './StatTileGrid';
import { WLChip } from './WLChip';

const LABEL_CLS = 'tracked text-[10px] text-[var(--color-text-secondary)]';

/**
 * A player's career snapshot: avatar and name beside the EHOG badge (the one on the player page),
 * then W-L, KDA and ADR tiles, and optionally a Form row of their last results. Shared by the home
 * page's My Stats panel and the player hover card so the two read the same. `summary` comes from
 * `getPlayerSummary()` (`src/lib/queries/playerSummary.ts`).
 */
export function PlayerSummaryBlock({
  summary,
  isMe = false,
  showForm = false,
  compact = false,
}: {
  summary: PlayerSummary;
  isMe?: boolean;
  /** Add the Form row (last results as W / L chips) under the tiles. */
  showForm?: boolean;
  /** Tighter tiles, for the hover card. */
  compact?: boolean;
}) {
  const { playerId, playerName, avatarUrl, ehog, record, kda, kd, adr, recent } = summary;
  const played = record.wins + record.losses > 0;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <Link
          href={`/players/${playerId}`}
          className="flex items-center gap-3 min-w-0 font-display text-[24px] font-bold hover:opacity-80 transition-opacity"
        >
          <PlayerAvatar name={playerName} imageUrl={avatarUrl} size="md" round />
          <span className="truncate"><PlayerName name={playerName} isMe={isMe} /></span>
        </Link>
        {ehog != null && <EhogBadge rating={ehog} />}
      </div>

      <StatTileGrid
        columns="grid-cols-3"
        compact={compact}
        tiles={[
          { label: 'W-L', title: 'Career match record', value: played ? `${record.wins}-${record.losses}` : '—' },
          {
            label: 'KDA',
            title: 'Career (kills + assists) per death; K/D is kills per death',
            value: played ? kda.toFixed(2) : '—',
            sub: played ? `${kd.toFixed(2)} K/D` : undefined,
          },
          { label: 'ADR', title: 'Career average damage per round', value: played ? adr.toFixed(2) : '—' },
        ]}
      />

      {showForm && (
        <div className="mt-2.5 flex items-center gap-3">
          <span className={LABEL_CLS}>Form</span>
          {recent.length === 0 ? (
            <span className="text-[12px] text-[var(--color-text-secondary)]">No recent matches</span>
          ) : (
            <div className="flex items-center gap-2">
              {recent.map((m) => <WLChip key={m.matchId} won={m.won} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
