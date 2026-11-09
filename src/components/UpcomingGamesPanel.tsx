'use client';

import Link from 'next/link';
import { LocalTime } from './LocalTime';
import { CountdownTimer } from './CountdownTimer';
import { PlayerName } from './PlayerName';
import { PanelHeader, PanelLink } from './PanelHeader';
import { toSentenceCase } from '@/lib/maps';
import { FeatureMatchIcon } from './FeatureMatch';
import type { ReactNode } from 'react';
import type { UpcomingGameRow, UpcomingScrimNight } from '@/lib/queries';
import { effectivePickedMap } from '@/lib/veto';
import { scrimNightHref } from '@/lib/crumbs';
import { Seats } from './ScrimSeats';
import { nightFill, signupCounts } from '@/lib/scrim-seats';
import { UpcomingWeekStrip } from './UpcomingWeekStrip';

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

      {game.scheduled_at && <When iso={game.scheduled_at} />}
    </Link>
  );
}

/** A row's when: the day of the week over the day of the month, then the time over a countdown. */
function When({ iso }: { iso: string }) {
  return (
    <>
      <div className="shrink-0 w-10 text-center font-mono leading-none" style={{ color: 'var(--color-site-accent)' }}>
        <div className="tracked text-[10px]">
          <LocalTime iso={iso} opts={{ weekday: 'short' }} />
        </div>
        <div className="text-[22px] font-medium mt-1">
          <LocalTime iso={iso} opts={{ day: 'numeric' }} />
        </div>
      </div>
      <div className="shrink-0 w-[84px] text-right">
        <div className="font-mono text-[11px]" style={{ color: 'var(--color-site-accent)' }}>
          <LocalTime iso={iso} opts={{ hour: 'numeric', minute: '2-digit' }} />
        </div>
        <CountdownTimer iso={iso} className="tracked text-[9px] text-[var(--color-text-secondary)] mt-0.5" />
      </div>
    </>
  );
}

const SCRIM_FILL_CLS = {
  full: 'bg-[var(--color-accent-green-bg)]',
  'could-fill': 'shadow-[inset_3px_0_0_var(--color-accent-amber-border)]',
  short: '',
} as const;

/** A scrim night among the games: its seats (`Seats`) where a game names its teams, the night tinted
 *  green once all four are definite or edged in amber when its maybes could fill it, and — for a
 *  signed-in viewer — whether they're in, a maybe, or not signed up yet. Links to the night's page. */
function ScrimNightRow({ upcoming, currentPlayerId }: { upcoming: UpcomingScrimNight; currentPlayerId: number | null }) {
  const { night, signups } = upcoming;
  const { definite, maybe } = signupCounts(signups);
  const fill = nightFill(definite, maybe);
  const mine = signups.find((s) => s.player_id === currentPlayerId)?.commitment ?? null;
  return (
    <Link
      href={scrimNightHref(night.id)}
      className={`lift-row flex items-center gap-3.5 px-5 py-3 border-b border-[var(--color-border-tertiary)] last:border-b-0 ${SCRIM_FILL_CLS[fill]}`}
    >
      <Seats definite={definite} maybe={maybe} />
      <div className="min-w-0 flex-1">
        <div className="tracked text-[9px] text-[var(--color-text-secondary)] mb-0.5">
          Scrim night{fill === 'full' && ' · on'}
        </div>
        <div className="font-display text-[13px] font-semibold truncate">
          {definite} in{maybe > 0 && ` · ${maybe} maybe`}
        </div>
      </div>
      {currentPlayerId != null && (
        <span
          className={`shrink-0 tracked text-[9px] px-1.5 py-0.5 border ${
            mine === 'definite'
              ? 'border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)]'
              : mine === 'maybe'
                ? 'border-[var(--color-border-primary)] text-[var(--color-text-secondary)]'
                : 'border-[var(--color-site-accent)] text-[var(--color-site-accent)]'
          }`}
        >
          {mine === 'definite' ? 'You’re in' : mine === 'maybe' ? 'Maybe' : 'Join'}
        </span>
      )}
      <When iso={night.startsAt} />
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
  top,
  rows,
  className,
}: {
  title: string;
  titleHref: string;
  allGamesHref?: string;
  /** Drawn between the title and the rows. */
  top?: ReactNode;
  rows: ReactNode[];
  className?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className={`border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]${className ? ` ${className}` : ''}`}>
      <PanelHeader
        title={title}
        titleHref={titleHref}
        right={allGamesHref && <PanelLink href={allGamesHref}>All games →</PanelLink>}
      />
      {top}
      {rows}
    </div>
  );
}

/** Home page panels: an "Upcoming" block — the week ahead at a glance (`UpcomingWeekStrip`), then
 *  every scheduled-but-unplayed game and every scrim night that hasn't ended (`ScrimNightRow`),
 *  soonest first — and a "To Be Scheduled" block for every
 *  unplayed game still missing a time — the one "what's coming up" surface for a regular season, a
 *  gauntlet and scrims. Either block is omitted when its own list is empty, and the whole thing
 *  renders nothing when both are — the caller doesn't need its own emptiness check to decide whether
 *  to show it. The Upcoming title links to `headingHref` (the current week's or round's page,
 *  or the scrims page when no season is running); the To Be Scheduled title and its "All games →"
 *  link go to `scheduleHref` (the season's Schedule tab). `scheduled`/`unscheduled` are pre-derived
 *  by the caller — see `getHomeGames()` (`src/lib/queries/home.ts`); `scrims` is
 *  `getUpcomingScrimNights()`. */
export function UpcomingGamesPanel({
  scheduled,
  unscheduled,
  scrims = [],
  headingHref,
  scheduleHref,
  currentPlayerId,
}: {
  scheduled: UpcomingGameRow[];
  unscheduled: UpcomingGameRow[];
  scrims?: UpcomingScrimNight[];
  headingHref: string;
  scheduleHref: string;
  currentPlayerId: number | null;
}) {
  if (scheduled.length === 0 && unscheduled.length === 0 && scrims.length === 0) return null;

  const upcoming = [
    ...scheduled.map((g) => ({ at: g.scheduled_at!, row: <GameRow key={`g${g.id}`} game={g} currentPlayerId={currentPlayerId} /> })),
    ...scrims.map((u) => ({ at: u.night.startsAt, row: <ScrimNightRow key={`s${u.night.id}`} upcoming={u} currentPlayerId={currentPlayerId} /> })),
  ]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .map((item) => item.row);

  return (
    <div className="flex flex-col gap-4">
      <GameBlock
        title="Upcoming"
        titleHref={headingHref}
        top={<UpcomingWeekStrip gameTimes={scheduled.map((g) => g.scheduled_at!)} scrims={scrims} />}
        rows={upcoming}
      />
      <GameBlock
        title="To Be Scheduled"
        titleHref={scheduleHref}
        allGamesHref={scheduleHref}
        rows={unscheduled.map((g) => <GameRow key={g.id} game={g} currentPlayerId={currentPlayerId} />)}
      />
    </div>
  );
}
