'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import EmptyState from './EmptyState';
import ErrorText from './ErrorText';
import { LocalTime } from './LocalTime';
import { CountdownTimer } from './CountdownTimer';
import { AddPlayerSelect, RosterPlayerRow, RosterRemoveButton } from './RosterPlayerRow';
import { ADMIN_SMALL_AMBER_BUTTON_CLS, ADMIN_SMALL_BUTTON_CLS, ADMIN_SMALL_GREEN_BUTTON_CLS } from './adminButtonStyles';
import { sendJsonRequest } from './sendJsonRequest';
import { useAsyncAction } from './useAsyncAction';
import type { ScrimSignupEntry } from '@/lib/queries';
import { SCRIM_COMMITMENTS, type ScrimCommitment, type ScrimNightSlot } from '@/lib/scrim-schedule';

interface Props {
  night: ScrimNightSlot;
  started: boolean;
  signups: ScrimSignupEntry[];
  currentPlayerId: number | null;
  isAdmin: boolean;
  allPlayers: { id: number; name: string }[];
}

const COMMITMENT_LABEL: Record<ScrimCommitment, string> = { definite: 'Definite', maybe: 'Maybe' };

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

/** The next scrim night: when it is, who's coming (definite, then maybe), and the controls to sign up,
 *  switch between definite and maybe, or drop out. Admins can do the same for any player. */
export function ScrimNightPanel({ night, started, signups, currentPlayerId, isAdmin, allPlayers }: Props) {
  const router = useRouter();
  const { busy, error, run } = useAsyncAction();
  // The player whose signup is being changed, so only their controls show as pending.
  const [target, setTarget] = useState<number | null>(null);
  const pending = busy ? target : null;
  const [addPlayerId, setAddPlayerId] = useState('');
  const [, startTransition] = useTransition();

  const mine = signups.find((s) => s.player_id === currentPlayerId) ?? null;

  function mutate(playerId: number, commitment: ScrimCommitment | null) {
    setTarget(playerId);
    return run(async () => {
      const url = `/api/scrims/${night.date}/signups`;
      if (commitment) await sendJsonRequest('POST', url, { player_id: playerId, commitment });
      else await sendJsonRequest('DELETE', url, { player_id: playerId });
      startTransition(() => router.refresh());
    });
  }

  function group(commitment: ScrimCommitment) {
    const entries = signups.filter((s) => s.commitment === commitment);
    const other: ScrimCommitment = commitment === 'definite' ? 'maybe' : 'definite';
    return (
      <div key={commitment}>
        <div className="px-4 py-2 border-b border-[var(--color-border-tertiary)] tracked text-[10px] text-[var(--color-text-secondary)]">
          {COMMITMENT_LABEL[commitment]} · {entries.length}
        </div>
        {entries.length === 0 ? (
          <EmptyState message={commitment === 'definite' ? 'Nobody locked in yet.' : 'No maybes.'} className="px-4 py-3" />
        ) : (
          entries.map((s) => (
            <RosterPlayerRow
              key={s.player_id}
              playerId={s.player_id}
              name={s.player_name}
              avatarUrl={s.steam_avatar_url}
              isMe={s.player_id === currentPlayerId}
            >
              {isAdmin && (
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => mutate(s.player_id, other)}
                    disabled={pending === s.player_id}
                    className="font-mono text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-40"
                  >
                    Make {COMMITMENT_LABEL[other].toLowerCase()}
                  </button>
                  <RosterRemoveButton onClick={() => mutate(s.player_id, null)} pending={pending === s.player_id} />
                </div>
              )}
            </RosterPlayerRow>
          ))
        )}
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
          <div className="tracked text-[10px] mb-1" style={{ color: 'var(--color-site-accent)' }}>
            {started ? 'Happening now' : 'Next scrims'}
          </div>
          <div className="font-display text-[22px] font-semibold leading-tight">
            <LocalTime iso={night.startsAt} opts={START_FORMAT} />
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
              <button type="button" onClick={() => mutate(currentPlayerId, null)} disabled={pending === currentPlayerId} className={IDLE_BTN_CLS}>
                Drop out
              </button>
            )}
          </div>
        )}
      </div>

      {SCRIM_COMMITMENTS.map(group)}

      {isAdmin && (
        <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-border-tertiary)]">
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
      <ErrorText error={error} size={12} className="px-4 pb-3" />
    </div>
  );
}
