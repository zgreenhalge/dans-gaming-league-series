'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PlayerAvatar from './PlayerAvatar';
import { PlayerName } from './PlayerName';

interface RosterEntry {
  player_id: number;
  player_name: string;
  steam_avatar_url: string | null;
}

interface AllPlayer {
  id: number;
  name: string;
}

interface Props {
  seasonId: number;
  roster: RosterEntry[];
  allPlayers: AllPlayer[];
  isAdmin: boolean;
  currentPlayerId: number | null;
}

const GREEN_BTN_CLS = 'border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] hover:brightness-110';

/** Roster editor for an UPCOMING season's `season_players` — admins manage the full roster,
 * everyone else can join or drop themselves. Only rendered while the season is UPCOMING (the API
 * enforces the same gate server-side). */
export function SeasonRosterPanel({ seasonId, roster, allPlayers, isAdmin, currentPlayerId }: Props) {
  const router = useRouter();
  const [pendingPlayerId, setPendingPlayerId] = useState<number | null>(null);
  const [addPlayerId, setAddPlayerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const rosterIds = new Set(roster.map((r) => r.player_id));
  const addablePlayers = allPlayers.filter((p) => !rosterIds.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  const selfOnRoster = currentPlayerId != null && rosterIds.has(currentPlayerId);

  async function mutate(playerId: number, method: 'POST' | 'DELETE') {
    setError(null);
    setPendingPlayerId(playerId);
    try {
      const res = await fetch(`/api/seasons/${seasonId}/players`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_id: playerId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Roster update failed.');
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setPendingPlayerId(null);
    }
  }

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <div className="px-4 py-3 border-b border-[var(--color-border-tertiary)] flex items-center justify-between gap-3">
        <div className="tracked text-[10px] text-[var(--color-text-secondary)]">
          Roster · {roster.length} {roster.length === 1 ? 'player' : 'players'}
        </div>
        {!isAdmin && currentPlayerId != null && (
          <button
            type="button"
            onClick={() => mutate(currentPlayerId, selfOnRoster ? 'DELETE' : 'POST')}
            disabled={pendingPlayerId === currentPlayerId}
            className={`tracked text-[10px] font-semibold px-2 py-1 border transition-colors disabled:opacity-40 ${
              selfOnRoster
                ? 'border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)]'
                : GREEN_BTN_CLS
            }`}
          >
            {pendingPlayerId === currentPlayerId ? '…' : selfOnRoster ? 'Leave Season' : 'Join Season'}
          </button>
        )}
      </div>

      {roster.length === 0 ? (
        <div className="px-4 py-3 font-mono text-[12px] text-[var(--color-text-secondary)]">
          No players on the roster yet.
        </div>
      ) : (
        roster.map((r) => (
          <div
            key={r.player_id}
            className="lift-row flex items-center justify-between gap-3 px-4 py-2.5 border-b border-[var(--color-border-tertiary)] last:border-b-0"
          >
            <Link href={`/players/${r.player_id}`} className="flex items-center gap-3">
              <PlayerAvatar name={r.player_name} imageUrl={r.steam_avatar_url} size="sm" />
              <span className="font-display text-[14px] font-semibold">
                <PlayerName name={r.player_name} isMe={currentPlayerId !== null && r.player_id === currentPlayerId} />
              </span>
            </Link>
            {isAdmin && (
              <button
                type="button"
                onClick={() => mutate(r.player_id, 'DELETE')}
                disabled={pendingPlayerId === r.player_id}
                className="font-mono text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-red-fg,#f87171)] transition-colors disabled:opacity-40"
              >
                {pendingPlayerId === r.player_id ? '…' : 'Remove'}
              </button>
            )}
          </div>
        ))
      )}

      {isAdmin && (
        <div className="px-4 py-3 flex items-center gap-2">
          <select
            value={addPlayerId}
            onChange={(e) => setAddPlayerId(e.target.value)}
            className="flex-1 font-mono text-[13px] px-3 py-2 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]"
          >
            <option value="">Add a player…</option>
            {addablePlayers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              const id = Number(addPlayerId);
              if (!Number.isFinite(id)) return;
              setAddPlayerId('');
              mutate(id, 'POST');
            }}
            disabled={!addPlayerId || pendingPlayerId != null}
            className={`tracked text-[10px] font-semibold px-3 py-2 border transition-colors disabled:opacity-40 ${
              addPlayerId
                ? GREEN_BTN_CLS
                : 'border-[var(--color-border-primary)] text-[var(--color-text-secondary)]'
            }`}
          >
            Add
          </button>
        </div>
      )}
      {error && (
        <div className="px-4 pb-3 text-[12px] text-[var(--color-accent-red-fg,#f87171)]">{error}</div>
      )}
    </div>
  );
}
