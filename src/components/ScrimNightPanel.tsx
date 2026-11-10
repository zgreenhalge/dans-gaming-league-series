'use client';

import Link from 'next/link';
import { LocalTime } from './LocalTime';
import { CountdownTimer } from './CountdownTimer';
import { ScrimCommitmentButtons } from './ScrimCommitmentButtons';
import { ScrimNightRoster } from './ScrimNightRoster';
import type { UpcomingScrimNight } from '@/lib/queries';
import { scrimNightHref } from '@/lib/crumbs';

interface Props {
  upcoming: UpcomingScrimNight;
  currentPlayerId: number | null;
  isAdmin: boolean;
  allPlayers: { id: number; name: string }[];
}

const START_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
};

/** A scrim night that hasn't ended, on the `/scrims` calendar: when it is (a link to the night's page,
 *  with a countdown until it starts), the viewer's own commitment (`ScrimCommitmentButtons`), and who's
 *  coming (`ScrimNightRoster`, folding away under its Attendance header, with an admin's menus). */
export function ScrimNightPanel({ upcoming, currentPlayerId, isAdmin, allPlayers }: Props) {
  const { night, started, checkInOpen, signups } = upcoming;
  const mine = signups.find((s) => s.player_id === currentPlayerId) ?? null;

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <div
        className="px-4 py-4 border-b border-[var(--color-border-tertiary)] flex flex-wrap items-start justify-between gap-4"
        style={{ borderTop: '3px solid var(--color-site-accent)' }}
      >
        <div className="min-w-0">
          <div className="font-display text-[22px] font-semibold leading-tight">
            <Link href={scrimNightHref(night.id)} className="hover:underline">
              <LocalTime iso={night.startsAt} opts={START_FORMAT} />
            </Link>
          </div>
          {!started && <CountdownTimer iso={night.startsAt} className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1" />}
        </div>

        {currentPlayerId != null && <ScrimCommitmentButtons nightId={night.id} playerId={currentPlayerId} commitment={mine?.commitment ?? null} />}
      </div>

      <ScrimNightRoster
        nightId={night.id}
        signups={signups}
        checkInOpen={checkInOpen}
        currentPlayerId={currentPlayerId}
        admin={isAdmin}
        allPlayers={allPlayers}
        collapsible
      />
    </div>
  );
}
