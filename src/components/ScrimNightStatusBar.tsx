'use client';

import Link from 'next/link';
import ErrorText from './ErrorText';
import { ArmedConfirmButton } from './ArmedConfirmButton';
import { CountdownTimer } from './CountdownTimer';
import { LocalTime } from './LocalTime';
import { LeagueGameMark } from './ScrimSeats';
import { ScrimCommitmentButtons } from './ScrimCommitmentButtons';
import { StatusPill } from './StatusPill';
import { ADMIN_SMALL_BUTTON_CLS, ADMIN_SMALL_GREEN_BUTTON_CLS } from './adminButtonStyles';
import { useRefreshingAction } from './useRefreshingAction';
import { useScrimSignupWrite } from './useScrimSignupWrite';
import type { ScrimNightStatus } from '@/lib/scrim-night-page';

const STATE_PILL = {
  upcoming: <StatusPill variant="accent">Upcoming</StatusPill>,
  live: <StatusPill variant="live">Happening now</StatusPill>,
  final: <StatusPill variant="neutral">Final</StatusPill>,
};

/** The scrim night page's status bar, above every tab: the night's state (a countdown while it's
 *  upcoming), how many have checked in while check-in is open, each league match scheduled during the
 *  night (its diamond and time, linking to the match: it takes the server), and the viewer's own
 *  commitment and Check in / Check out. What it shows is `buildScrimNightPageModel()`'s `status`. */
export function ScrimNightStatusBar({
  nightId,
  startsAt,
  status,
}: {
  nightId: number;
  startsAt: string;
  status: ScrimNightStatus;
}) {
  const { state, checkedInCount, leagueMatches, checkIn, commitment } = status;
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {STATE_PILL[state]}
        {state === 'upcoming' && <CountdownTimer iso={startsAt} className="font-mono text-[12px] text-[var(--color-text-secondary)]" />}
        {checkedInCount != null && <span className="font-mono text-[12px] text-[var(--color-text-secondary)]">{checkedInCount} checked in</span>}
        {leagueMatches.map((m) => (
          <Link
            key={m.id}
            href={`/matches/${m.id}`}
            title={`${m.label} takes the server`}
            className="inline-flex items-center gap-1.5 font-mono text-[12px] hover:underline"
          >
            <LeagueGameMark />
            <LocalTime iso={m.scheduledAt} opts={{ hour: 'numeric', minute: '2-digit' }} />
          </Link>
        ))}
      </div>
      {(commitment || checkIn) && (
        <div className="flex flex-wrap items-start gap-2">
          {commitment && <ScrimCommitmentButtons nightId={nightId} {...commitment} />}
          {checkIn && <ScrimCheckInButton nightId={nightId} {...checkIn} />}
        </div>
      )}
    </div>
  );
}

/** The viewer's own Check in / Check out for a night. */
function ScrimCheckInButton({ nightId, playerId, checkedIn }: { nightId: number; playerId: number; checkedIn: boolean }) {
  const { busy, error, setCheckIn } = useScrimSignupWrite(nightId);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => setCheckIn(playerId, !checkedIn)}
        disabled={busy}
        className={`${checkedIn ? ADMIN_SMALL_BUTTON_CLS : ADMIN_SMALL_GREEN_BUTTON_CLS} disabled:opacity-40`}
      >
        {busy ? '…' : checkedIn ? 'Check out' : 'Check in'}
      </button>
      <ErrorText error={error} size={12} />
    </span>
  );
}

/** End night (`POST /api/scrims/[id]/end`), after a confirm: closes the night before the clock does. */
export function ScrimEndNightButton({ nightId }: { nightId: number }) {
  const { busy, error, act } = useRefreshingAction();
  return (
    <ArmedConfirmButton
      onConfirm={() => act('POST', `/api/scrims/${nightId}/end`)}
      busy={busy}
      error={error}
      triggerLabel="End night"
      confirmLabel="End night for everyone"
      busyLabel="Ending…"
      variant="danger"
    />
  );
}
