'use client';

import Link from 'next/link';
import { LocalTime } from './LocalTime';
import { CountdownTimer } from './CountdownTimer';
import { PlayerName } from './PlayerName';
import { PanelHeader, PanelLink } from './PanelHeader';
import { toSentenceCase } from '@/lib/maps';
import { FeatureMatchIcon } from './FeatureMatch';
import type { UpcomingGameRow } from '@/lib/queries';
import { effectivePickedMap } from '@/lib/veto';

function TeamNames({ players, dimmed, currentPlayerId }: { players: { player_id: number; player_name: string }[]; dimmed?: boolean; currentPlayerId?: number | null }) {
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
  const map = effectivePickedMap(game);

  return (
    <Link
      href={`/matches/${game.id}`}
      className="lift-row flex items-center gap-3.5 px-5 py-3 border-b border-[var(--color-border-tertiary)] last:border-b-0"
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

      {game.scheduled_at && (
        <>
          <div className="shrink-0 w-10 text-center font-mono leading-none" style={{ color: 'var(--color-site-accent)' }}>
            <div className="tracked text-[10px]">
              <LocalTime iso={game.scheduled_at} opts={{ weekday: 'short' }} />
            </div>
            <div className="text-[22px] font-medium mt-1">
              <LocalTime iso={game.scheduled_at} opts={{ day: 'numeric' }} />
            </div>
          </div>
          <div className="shrink-0 w-[84px] text-right">
            <div className="font-mono text-[11px]" style={{ color: 'var(--color-site-accent)' }}>
              <LocalTime iso={game.scheduled_at} opts={{ hour: 'numeric', minute: '2-digit' }} />
            </div>
            <CountdownTimer iso={game.scheduled_at} className="tracked text-[9px] text-[var(--color-text-secondary)] mt-0.5" />
          </div>
        </>
      )}
    </Link>
  );
}

/** A single bordered block of `GameRow`s under a linked title — the shape shared by the "Upcoming
 *  Games" and "To Be Scheduled" blocks. `allGamesHref` adds an "All games →" link to the right of
 *  the title. Renders nothing when `games` is empty, so a caller doesn't need its own parallel
 *  emptiness check. */
function GameBlock({
  title,
  titleHref,
  allGamesHref,
  games,
  currentPlayerId,
  className,
}: {
  title: string;
  titleHref: string;
  allGamesHref?: string;
  games: UpcomingGameRow[];
  currentPlayerId: number | null;
  className?: string;
}) {
  if (games.length === 0) return null;
  return (
    <div className={`border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]${className ? ` ${className}` : ''}`}>
      <PanelHeader
        title={title}
        titleHref={titleHref}
        right={allGamesHref && <PanelLink href={allGamesHref}>All games →</PanelLink>}
      />
      {games.map((g) => (
        <GameRow key={g.id} game={g} currentPlayerId={currentPlayerId} />
      ))}
    </div>
  );
}

/** Home page panels: an "Upcoming Games" block for every scheduled-but-unplayed game (soonest
 *  first) and a "To Be Scheduled" block for every unplayed game still missing a time — the one
 *  "what's coming up" surface for both a regular season and a gauntlet. Either block is omitted
 *  when its own list is empty, and the whole thing renders nothing when both are — the caller
 *  doesn't need its own emptiness check to decide whether to show it. The Upcoming Games title
 *  links to `headingHref` (the current week's or round's page); the To Be Scheduled title and its
 *  "All games →" link go to `scheduleHref` (the season's Schedule tab). `scheduled`/`unscheduled`
 *  are pre-derived by the caller — see `getHomeGames()` (`src/lib/queries/home.ts`). */
export function UpcomingGamesPanel({
  scheduled,
  unscheduled,
  headingHref,
  scheduleHref,
  currentPlayerId,
}: {
  scheduled: UpcomingGameRow[];
  unscheduled: UpcomingGameRow[];
  headingHref: string;
  scheduleHref: string;
  currentPlayerId: number | null;
}) {
  if (scheduled.length === 0 && unscheduled.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      <GameBlock title="Upcoming Games" titleHref={headingHref} games={scheduled} currentPlayerId={currentPlayerId} />
      <GameBlock
        title="To Be Scheduled"
        titleHref={scheduleHref}
        allGamesHref={scheduleHref}
        games={unscheduled}
        currentPlayerId={currentPlayerId}
      />
    </div>
  );
}
