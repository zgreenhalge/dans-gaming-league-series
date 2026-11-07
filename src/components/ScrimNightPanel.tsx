'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ErrorText from './ErrorText';
import { LocalTime } from './LocalTime';
import { CountdownTimer } from './CountdownTimer';
import { AddPlayerSelect, RosterPlayerRow, RosterRemoveButton } from './RosterPlayerRow';
import { ADMIN_SMALL_AMBER_BUTTON_CLS, ADMIN_SMALL_BUTTON_CLS, ADMIN_SMALL_GREEN_BUTTON_CLS } from './adminButtonStyles';
import { sendJsonRequest } from './sendJsonRequest';
import { useAsyncAction } from './useAsyncAction';
import { StatusPill } from './StatusPill';
import type { UpcomingScrimNight } from '@/lib/queries';
import { scrimNightHref } from '@/lib/crumbs';
import { SCRIM_COMMITMENTS, type ScrimCommitment } from '@/lib/scrim-schedule';

interface Props {
  upcoming: UpcomingScrimNight;
  currentPlayerId: number | null;
  isAdmin: boolean;
  allPlayers: { id: number; name: string }[];
  /** Make the start time a link to the night's page (off on the night page itself). */
  showNightLink?: boolean;
  /** Offer End night: the viewer is signed up or an admin, and the night has started (night page only). */
  canEnd?: boolean;
}

const COMMITMENT_LABEL: Record<ScrimCommitment, string> = { definite: 'Definite', maybe: 'Maybe' };

/** Drop out: red text with no border or fill, so it reads apart from the commitment choices. */
const DROP_OUT_BTN_CLS =
  'tracked text-[10px] font-semibold px-2 py-1 text-[var(--color-accent-red-fg,#f87171)] hover:underline transition-colors disabled:opacity-40';
const IDLE_BTN_CLS = `${ADMIN_SMALL_BUTTON_CLS} disabled:opacity-40`;
const ACTIVE_BTN_CLS: Record<ScrimCommitment, string> = {
  definite: `${ADMIN_SMALL_GREEN_BUTTON_CLS} disabled:opacity-40`,
  maybe: `${ADMIN_SMALL_AMBER_BUTTON_CLS} disabled:opacity-40`,
};

const START_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
};

/** A scrim night that hasn't ended: when it is, who's coming (definite, then maybe, with a "Here" pill
 *  on whoever has checked in), and the controls to sign up, switch between definite and maybe, or drop
 *  out. Checking in is the lobby's (`ScrimLobbyPanel`). Admins can do all of it for any player, and
 *  check players in or out, from an Admin controls toggle that stays closed until opened.
 *  When the last player drops out the night is removed, and the panel goes back to `/scrims`. On the
 *  night page, `canEnd` adds an End night button that closes the night before the clock does. */
export function ScrimNightPanel({ upcoming, currentPlayerId, isAdmin, allPlayers, showNightLink, canEnd }: Props) {
  const { night, started, checkInOpen, signups } = upcoming;
  const router = useRouter();
  const { busy, error, run } = useAsyncAction();
  // The player whose signup is being changed, so only their controls show as pending.
  const [target, setTarget] = useState<number | null>(null);
  const pending = busy ? target : null;
  const [addPlayerId, setAddPlayerId] = useState('');
  // An admin's controls over other players' signups stay folded away until asked for.
  const [adminOpen, setAdminOpen] = useState(false);
  // The attendance lists fold away to leave the night's controls.
  const [attendanceOpen, setAttendanceOpen] = useState(true);
  const showAdmin = isAdmin && adminOpen;
  const [, startTransition] = useTransition();

  const mine = signups.find((s) => s.player_id === currentPlayerId) ?? null;

  function send(playerId: number, method: 'POST' | 'DELETE', path: 'signups' | 'check-in', body: Record<string, unknown> = {}) {
    setTarget(playerId);
    return run(async () => {
      const res = await sendJsonRequest<{ nightRemoved?: boolean } | null>(method, `/api/scrims/${night.id}/${path}`, { player_id: playerId, ...body });
      startTransition(() => (res?.nightRemoved ? router.push('/scrims') : router.refresh()));
    });
  }

  function endNight() {
    if (!window.confirm('End this scrim night for everyone?')) return;
    return run(async () => {
      await sendJsonRequest('POST', `/api/scrims/${night.id}/end`, {});
      startTransition(() => router.refresh());
    });
  }

  function mutate(playerId: number, commitment: ScrimCommitment | null) {
    return commitment ? send(playerId, 'POST', 'signups', { commitment }) : send(playerId, 'DELETE', 'signups');
  }

  function setCheckIn(playerId: number, checkedIn: boolean) {
    return send(playerId, checkedIn ? 'POST' : 'DELETE', 'check-in');
  }

  function group(commitment: ScrimCommitment) {
    const entries = signups.filter((s) => s.commitment === commitment);
    const other: ScrimCommitment = commitment === 'definite' ? 'maybe' : 'definite';
    return (
      <div key={commitment}>
        <div className="px-4 py-2 border-b border-[var(--color-border-tertiary)] bg-[var(--color-bg-secondary)] tracked text-[11px] font-semibold text-[var(--color-text-primary)]">
          {COMMITMENT_LABEL[commitment]} · {entries.length}
        </div>
        {/* Indented under its heading; an empty group shows just the heading's count. */}
        <div className="pl-4">
          {entries.map((s) => (
            <RosterPlayerRow
              key={s.player_id}
              playerId={s.player_id}
              name={s.player_name}
              avatarUrl={s.steam_avatar_url}
              isMe={s.player_id === currentPlayerId}
            >
              <div className="flex items-center gap-3 shrink-0">
                {s.checked_in_at && <StatusPill variant="live">Here</StatusPill>}
                {showAdmin && (
                  <>
                    {checkInOpen && (
                      <button
                        type="button"
                        onClick={() => setCheckIn(s.player_id, !s.checked_in_at)}
                        disabled={pending === s.player_id}
                        className="font-mono text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-40"
                      >
                        {s.checked_in_at ? 'Check out' : 'Check in'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => mutate(s.player_id, other)}
                      disabled={pending === s.player_id}
                      className="font-mono text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-40"
                    >
                      Make {COMMITMENT_LABEL[other].toLowerCase()}
                    </button>
                    <RosterRemoveButton onClick={() => mutate(s.player_id, null)} pending={pending === s.player_id} />
                  </>
                )}
              </div>
            </RosterPlayerRow>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <div
        className="px-4 py-4 border-b border-[var(--color-border-tertiary)] flex flex-wrap items-start justify-between gap-4"
        style={{ borderTop: '3px solid var(--color-site-accent)' }}
      >
        <div className="min-w-0">
          <div className="font-display text-[22px] font-semibold leading-tight">
            {showNightLink ? (
              <Link href={scrimNightHref(night.id)} className="hover:underline">
                <LocalTime iso={night.startsAt} opts={START_FORMAT} />
              </Link>
            ) : (
              <LocalTime iso={night.startsAt} opts={START_FORMAT} />
            )}
          </div>
          {!started && <CountdownTimer iso={night.startsAt} className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1" />}
        </div>

        {currentPlayerId != null && (
          <div className="flex flex-wrap items-center gap-2">
            {SCRIM_COMMITMENTS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={mine?.commitment === c}
                onClick={() => mine?.commitment !== c && mutate(currentPlayerId, c)}
                disabled={pending === currentPlayerId}
                className={mine?.commitment === c ? ACTIVE_BTN_CLS[c] : IDLE_BTN_CLS}
              >
                {COMMITMENT_LABEL[c]}
              </button>
            ))}
            {mine && (
              <button type="button" onClick={() => mutate(currentPlayerId, null)} disabled={pending === currentPlayerId} className={DROP_OUT_BTN_CLS}>
                Drop out
              </button>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        aria-expanded={attendanceOpen}
        onClick={() => setAttendanceOpen(!attendanceOpen)}
        className="w-full text-left px-4 py-2 border-b border-[var(--color-border-tertiary)] tracked text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
      >
        {attendanceOpen ? '▾' : '▸'} Attendance · {signups.length}
      </button>
      {attendanceOpen && SCRIM_COMMITMENTS.map(group)}

      {isAdmin && (
        <div className="px-4 py-2 border-t border-[var(--color-border-tertiary)]">
          <button
            type="button"
            aria-expanded={adminOpen}
            onClick={() => setAdminOpen(!adminOpen)}
            className="font-mono text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            {adminOpen ? '▾' : '▸'} Admin controls
          </button>
        </div>
      )}
      {showAdmin && (
        <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
          <AddPlayerSelect
            players={allPlayers}
            excludeIds={new Set(signups.map((s) => s.player_id))}
            value={addPlayerId}
            onChange={setAddPlayerId}
            placeholder="Sign up a player…"
          />
          {SCRIM_COMMITMENTS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setAddPlayerId('');
                mutate(Number(addPlayerId), c);
              }}
              disabled={!addPlayerId || pending != null}
              className={addPlayerId ? ACTIVE_BTN_CLS[c] : IDLE_BTN_CLS}
            >
              Add as {COMMITMENT_LABEL[c].toLowerCase()}
            </button>
          ))}
        </div>
      )}
      {canEnd && (
        <div className="px-4 py-3 border-t border-[var(--color-border-tertiary)] flex flex-wrap items-center justify-between gap-3">
          <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">Everyone done? Closes check-in and the lobby.</span>
          <button
            type="button"
            onClick={endNight}
            disabled={busy}
            className={DROP_OUT_BTN_CLS}
          >
            End night
          </button>
        </div>
      )}
      <ErrorText error={error} size={12} className="px-4 py-3" />
    </div>
  );
}
