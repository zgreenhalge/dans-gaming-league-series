'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import EmptyState from './EmptyState';
import { AddPlayerSelect, RosterPlayerRow, RosterRemoveButton } from './RosterPlayerRow';
import { formatBuyIn } from '@/lib/season-buy-in';
import { GAUNTLET_MIN_QUALIFIERS, GAUNTLET_MAX_QUALIFIERS } from '@/lib/gauntlet-bracket';
import ErrorText from '@/components/ErrorText';

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
  buyInAmount: number | null;
}

const GREEN_BTN_CLS = 'border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] hover:brightness-110';

/** Roster editor for an UPCOMING season's `season_players` — admins manage the full roster,
 * everyone else can join or drop themselves. Only rendered while the season is UPCOMING (the API
 * enforces the same gate server-side). The season's buy-in, when set, shows in the header so
 * players see the cost before joining. */
export function SeasonRosterPanel({ seasonId, roster, allPlayers, isAdmin, currentPlayerId, buyInAmount }: Props) {
  const router = useRouter();
  const [pendingPlayerId, setPendingPlayerId] = useState<number | null>(null);
  const [addPlayerId, setAddPlayerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const rosterIds = new Set(roster.map((r) => r.player_id));
  const selfOnRoster = currentPlayerId != null && rosterIds.has(currentPlayerId);
  // Admin-only: players joining/leaving don't need to see gauntlet-planning warnings.
  const gauntletSizeUnsupported =
    isAdmin && roster.length > 0 && (roster.length < GAUNTLET_MIN_QUALIFIERS || roster.length > GAUNTLET_MAX_QUALIFIERS);

  async function mutate(playerId: number, method: 'POST' | 'DELETE') {
    setError(null);
    setPendingPlayerId(playerId);
    try {
      let res: Response;
      try {
        res = await fetch(`/api/seasons/${seasonId}/players`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ player_id: playerId }),
        });
      } catch {
        setError('Network error — roster update failed.');
        return;
      }
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
          {buyInAmount != null && <> · Buy-in {formatBuyIn(buyInAmount)}</>}
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

      {gauntletSizeUnsupported && (
        <div className="px-4 py-2 border-b border-[var(--color-accent-amber-border)] bg-[var(--color-accent-amber-bg)] text-[12px] text-[var(--color-accent-amber-fg)]">
          {roster.length} {roster.length === 1 ? 'player' : 'players'} won&apos;t produce an automated gauntlet
          bracket (needs {GAUNTLET_MIN_QUALIFIERS}–{GAUNTLET_MAX_QUALIFIERS}) — a gauntlet will need to be built
          by hand once the season ends.
        </div>
      )}

      {roster.length === 0 ? (
        <EmptyState message="No players on the roster yet." className="px-4 py-3" />
      ) : (
        roster.map((r) => (
          <RosterPlayerRow
            key={r.player_id}
            playerId={r.player_id}
            name={r.player_name}
            avatarUrl={r.steam_avatar_url}
            isMe={currentPlayerId !== null && r.player_id === currentPlayerId}
          >
            {isAdmin && <RosterRemoveButton onClick={() => mutate(r.player_id, 'DELETE')} pending={pendingPlayerId === r.player_id} />}
          </RosterPlayerRow>
        ))
      )}

      {isAdmin && (
        <div className="px-4 py-3 flex items-center gap-2">
          <AddPlayerSelect
            players={allPlayers}
            excludeIds={rosterIds}
            value={addPlayerId}
            onChange={setAddPlayerId}
            placeholder="Add a player…"
          />
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
      <ErrorText error={error} size={12} className="px-4 pb-3" />
    </div>
  );
}
