'use client';

import Link from 'next/link';
import { LocalTime } from './LocalTime';
import { CountdownTimer } from './CountdownTimer';
import { PlayerName } from './PlayerName';
import { toSentenceCase } from '@/lib/maps';
import { FeatureMatchIcon } from './FeatureMatch';
import type { UpcomingGameRow } from '@/lib/queries';

export function TeamNames({ players, dimmed, currentPlayerId }: { players: { player_id: number; player_name: string }[]; dimmed?: boolean; currentPlayerId?: number | null }) {
  if (players.length === 0) return <span className="opacity-50">TBD</span>;
  const cls = dimmed ? 'text-[var(--color-text-secondary)]' : '';
  return (
    <>
      {players.map((p, i) => (
        <span key={p.player_id} className={`inline-flex items-center gap-0.5 ${cls}`}>
          {i > 0 && <span className="mx-0.5">&amp;</span>}
          <PlayerName name={p.player_name} isMe={currentPlayerId !== null && p.player_id === currentPlayerId} />
        </span>
      ))}
    </>
  );
}

function GameRow({
  game,
  currentPlayerId,
}: {
  game: UpcomingGameRow;
  currentPlayerId: number | null;
}) {
  const map = game.shirts_pick ?? game.picked_map;

  return (
    <Link
      href={`/matches/${game.id}`}
      className="lift-row flex items-center gap-3 px-5 py-3 border-b border-[var(--color-border-tertiary)] last:border-b-0"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="tracked text-[9px] text-[var(--color-text-secondary)]">
            Match {game.match_number} {game.is_feature_match && <FeatureMatchIcon />}
          </span>
          {map && (
            <span className="tracked text-[9px] text-[var(--color-text-secondary)]">
              · {toSentenceCase(map)}
            </span>
          )}
        </div>
        <div className="font-display text-[13px] font-semibold truncate">
          <TeamNames players={game.shirts} currentPlayerId={currentPlayerId} />
          <span className="tracked text-[9px] text-[var(--color-text-secondary)] mx-1.5">vs</span>
          <TeamNames players={game.skins} currentPlayerId={currentPlayerId} />
        </div>
      </div>

      <div className="shrink-0 text-right">
        {game.scheduled_at ? (
          <>
            <div className="font-mono text-[11px]" style={{ color: 'var(--color-site-accent)' }}>
              <LocalTime
                iso={game.scheduled_at}
                opts={{ weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }}
              />
            </div>
            <CountdownTimer iso={game.scheduled_at} className="tracked text-[9px] text-[var(--color-text-secondary)] mt-0.5" />
          </>
        ) : (
          <span className="tracked text-[10px] text-[var(--color-text-secondary)] opacity-70">
            Needs a time
          </span>
        )}
      </div>
    </Link>
  );
}

/** Home page panel: every scheduled-but-unplayed game (soonest first), plus every unplayed game
 *  still missing a time — the one "what's coming up" surface for both a regular season and a
 *  gauntlet. `scheduled`/`unscheduled` are pre-derived by the caller: `getUpcomingGames()`
 *  (`src/lib/queries/schedule.ts`) for a regular season's current week, or
 *  `getUpcomingGauntletGames()` (`src/lib/queries/gauntlet.ts`) for a gauntlet, which has no weekly
 *  structure to anchor "next week" on and so surfaces every unscheduled bracket match instead. */
export function UpcomingGamesPanel({
  scheduled,
  unscheduled,
  currentPlayerId,
}: {
  scheduled: UpcomingGameRow[];
  unscheduled: UpcomingGameRow[];
  currentPlayerId: number | null;
}) {
  if (scheduled.length === 0 && unscheduled.length === 0) return null;

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <div className="px-6 py-4 border-b border-[var(--color-border-tertiary)]">
        <span className="font-display text-[18px] font-semibold text-[var(--color-text-primary)]">
          Upcoming Games
        </span>
      </div>

      {scheduled.map((g) => (
        <GameRow key={g.id} game={g} currentPlayerId={currentPlayerId} />
      ))}

      {unscheduled.length > 0 && (
        <>
          <div className="px-5 py-1.5 border-b border-[var(--color-border-tertiary)] bg-[var(--color-bg-secondary)]">
            <span className="tracked text-[9px] font-semibold text-[var(--color-text-secondary)]">
              Needs scheduling
            </span>
          </div>
          {unscheduled.map((g) => (
            <GameRow key={g.id} game={g} currentPlayerId={currentPlayerId} />
          ))}
        </>
      )}
    </div>
  );
}
