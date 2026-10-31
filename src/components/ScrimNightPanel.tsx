'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PlayerLink } from './PlayerLink';
import PlayerAvatar from './PlayerAvatar';
import { PlayerName } from './PlayerName';
import EmptyState from './EmptyState';
import ErrorText from './ErrorText';
import { LocalTime } from './LocalTime';
import { CountdownTimer } from './CountdownTimer';
import { sendJsonRequest } from './sendJsonRequest';
import { useAsyncAction } from './useAsyncAction';
import type { ScrimSignupEntry } from '@/lib/queries';
import type { ScrimCommitment, ScrimNightSlot } from '@/lib/scrim-schedule';

interface Props {
  night: ScrimNightSlot;
  started: boolean;
  signups: ScrimSignupEntry[];
  currentPlayerId: number | null;
  isAdmin: boolean;
  allPlayers: { id: number; name: string }[];
}

const COMMITMENT_LABEL: Record<ScrimCommitment, string> = { definite: 'Definite', maybe: 'Maybe' };

const BTN_CLS = 'tracked text-[10px] font-semibold px-2.5 py-1.5 border transition-colors disabled:opacity-40';
const IDLE_BTN_CLS = `${BTN_CLS} border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)]`;
const GREEN_BTN_CLS = `${BTN_CLS} border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)]`;
const AMBER_BTN_CLS = `${BTN_CLS} border-[var(--color-accent-amber-border)] text-[var(--color-accent-amber-fg)] bg-[var(--color-accent-amber-bg)]`;
const ACTIVE_BTN_CLS: Record<ScrimCommitment, string> = { definite: GREEN_BTN_CLS, maybe: AMBER_BTN_CLS };

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
  const definite = signups.filter((s) => s.commitment === 'definite');
  const maybe = signups.filter((s) => s.commitment === 'maybe');
  const signedUpIds = new Set(signups.map((s) => s.player_id));
  const addablePlayers = allPlayers.filter((p) => !signedUpIds.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));

  function mutate(playerId: number, commitment: ScrimCommitment | null) {
    setTarget(playerId);
    return run(async () => {
      const url = `/api/scrims/${night.date}/signups`;
      if (commitment) await sendJsonRequest('POST', url, { player_id: playerId, commitment });
      else await sendJsonRequest('DELETE', url, { player_id: playerId });
      startTransition(() => router.refresh());
    });
  }

  function row(s: ScrimSignupEntry) {
    const other: ScrimCommitment = s.commitment === 'definite' ? 'maybe' : 'definite';
    return (
      <div
        key={s.player_id}
        className="lift-row flex items-center justify-between gap-3 px-4 py-2.5 border-b border-[var(--color-border-tertiary)] last:border-b-0"
      >
        <PlayerLink playerId={s.player_id} className="flex items-center gap-3 min-w-0">
          <PlayerAvatar name={s.player_name} imageUrl={s.steam_avatar_url} size="sm" />
          <span className="font-display text-[14px] font-semibold truncate">
            <PlayerName name={s.player_name} isMe={s.player_id === currentPlayerId} />
          </span>
        </PlayerLink>
        {isAdmin && (
          <div className="flex items-center gap-3 shrink-0 font-mono text-[11px] text-[var(--color-text-secondary)]">
            <button
              type="button"
              onClick={() => mutate(s.player_id, other)}
              disabled={pending === s.player_id}
              className="hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-40"
            >
              Make {COMMITMENT_LABEL[other].toLowerCase()}
            </button>
            <button
              type="button"
              onClick={() => mutate(s.player_id, null)}
              disabled={pending === s.player_id}
              className="hover:text-[var(--color-accent-red-fg,#f87171)] transition-colors disabled:opacity-40"
            >
              Remove
            </button>
          </div>
        )}
      </div>
    );
  }

  function group(commitment: ScrimCommitment, entries: ScrimSignupEntry[]) {
    return (
      <div>
        <div className="px-4 py-2 border-b border-[var(--color-border-tertiary)] tracked text-[10px] text-[var(--color-text-secondary)]">
          {COMMITMENT_LABEL[commitment]} · {entries.length}
        </div>
        {entries.length === 0 ? (
          <EmptyState message={commitment === 'definite' ? 'Nobody locked in yet.' : 'No maybes.'} className="px-4 py-3" />
        ) : (
          entries.map(row)
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
            {(['definite', 'maybe'] as const).map((c) => (
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

      {group('definite', definite)}
      {group('maybe', maybe)}

      {isAdmin && (
        <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-border-tertiary)]">
          <select
            value={addPlayerId}
            onChange={(e) => setAddPlayerId(e.target.value)}
            aria-label="Sign up a player"
            className="flex-1 min-w-[160px] font-mono text-[13px] px-3 py-2 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]"
          >
            <option value="">Sign up a player…</option>
            {addablePlayers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {(['definite', 'maybe'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                const id = Number(addPlayerId);
                if (!addPlayerId || !Number.isFinite(id)) return;
                setAddPlayerId('');
                mutate(id, c);
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
