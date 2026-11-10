'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import EmptyState from './EmptyState';
import { AddPlayerSelect, RosterPlayerRow } from './RosterPlayerRow';
import { AdminMenu, type AdminMenuItem } from './AdminMenu';
import { ADMIN_SMALL_BUTTON_CLS, ADMIN_SMALL_GREEN_BUTTON_CLS } from './adminButtonStyles';
import { sendJsonRequest } from './sendJsonRequest';
import { useAsyncAction } from './useAsyncAction';
import { formatBuyIn } from '@/lib/season-buy-in';
import { GAUNTLET_MIN_QUALIFIERS, GAUNTLET_MAX_QUALIFIERS } from '@/lib/gauntlet-bracket';
import ErrorText from '@/components/ErrorText';
import SectionLabel from './SectionLabel';

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

/** Roster editor for an UPCOMING season's `season_players` — every viewer signed in as a
 * player, an admin included, gets the same Join / Leave Season button for themselves. An admin
 * manages everyone else from `AdminMenu`s: one on each other player's row (Remove) and one on the
 * roster header (Add player…). Only rendered while the season is UPCOMING (the API enforces the same
 * gate server-side). The season's buy-in, when set, shows in the header so players see the cost
 * before joining. */
export function SeasonRosterPanel({ seasonId, roster, allPlayers, isAdmin, currentPlayerId, buyInAmount }: Props) {
  const router = useRouter();
  const { busy: writing, error, run } = useAsyncAction();
  const [refreshing, startTransition] = useTransition();
  // One gate for every control: nothing else can start while a roster write or the refresh after
  // it is in flight, so `target` always names the one running write.
  const busy = writing || refreshing;
  // The player whose write is running, held through the refresh so their label doesn't flip back early.
  const [target, setTarget] = useState<number | null>(null);
  const pending = busy ? target : null;

  const rosterIds = new Set(roster.map((r) => r.player_id));
  const selfOnRoster = currentPlayerId != null && rosterIds.has(currentPlayerId);
  // The viewer's own place on the roster is the Join / Leave Season button's, so the picker leaves them out.
  const pickerExcludeIds = currentPlayerId == null ? rosterIds : new Set([...rosterIds, currentPlayerId]);
  const [pickedPlayerId, setPickedPlayerId] = useState('');
  // The picker keeps its pick while the menu is closed, until that player joins some other way.
  const addPlayerId = pickerExcludeIds.has(Number(pickedPlayerId)) ? '' : pickedPlayerId;
  // Admin-only: players joining/leaving don't need to see gauntlet-planning warnings.
  const gauntletSizeUnsupported =
    isAdmin && roster.length > 0 && (roster.length < GAUNTLET_MIN_QUALIFIERS || roster.length > GAUNTLET_MAX_QUALIFIERS);

  function mutate(playerId: number, method: 'POST' | 'DELETE') {
    setTarget(playerId);
    return run(async () => {
      await sendJsonRequest(method, `/api/seasons/${seasonId}/players`, { player_id: playerId });
      startTransition(() => router.refresh());
    });
  }

  /** The roster's admin actions: Add player… opens the player picker in the menu. */
  const rosterItems: AdminMenuItem[] = [
    {
      label: 'Add player…',
      content: (close) => (
        <div className="flex flex-wrap items-center gap-2">
          <AddPlayerSelect
            players={allPlayers}
            excludeIds={pickerExcludeIds}
            value={addPlayerId}
            onChange={setPickedPlayerId}
            placeholder="Add a player…"
          />
          <button
            type="button"
            onClick={() => {
              const playerId = Number(addPlayerId);
              setPickedPlayerId('');
              close();
              mutate(playerId, 'POST');
            }}
            disabled={!addPlayerId || busy}
            className={`${addPlayerId ? ADMIN_SMALL_GREEN_BUTTON_CLS : ADMIN_SMALL_BUTTON_CLS} disabled:opacity-40`}
          >
            Add
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <div className="px-4 py-3 border-b border-[var(--color-border-tertiary)] flex flex-wrap items-center justify-between gap-3">
        <SectionLabel>
          Roster · {roster.length} {roster.length === 1 ? 'player' : 'players'}
          {buyInAmount != null && <> · Buy-in {formatBuyIn(buyInAmount)}</>}
        </SectionLabel>
        <div className="flex items-center gap-2 shrink-0">
          {currentPlayerId != null && (
            <button
              type="button"
              onClick={() => mutate(currentPlayerId, selfOnRoster ? 'DELETE' : 'POST')}
              disabled={busy}
              className={`${selfOnRoster ? ADMIN_SMALL_BUTTON_CLS : ADMIN_SMALL_GREEN_BUTTON_CLS} disabled:opacity-40`}
            >
              {pending === currentPlayerId ? '…' : selfOnRoster ? 'Leave Season' : 'Join Season'}
            </button>
          )}
          {isAdmin && <AdminMenu label="Roster admin actions" items={rosterItems} />}
        </div>
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
        roster.map((r) => {
          const isMe = r.player_id === currentPlayerId;
          return (
            <RosterPlayerRow key={r.player_id} playerId={r.player_id} name={r.player_name} avatarUrl={r.steam_avatar_url} isMe={isMe}>
              {/* An admin's own row has no menu: their Leave Season button covers it. */}
              {isAdmin && !isMe && (
                <div className="flex items-center gap-2 shrink-0">
                  {pending === r.player_id && <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">…</span>}
                  <AdminMenu
                    label={`Admin actions for ${r.player_name}`}
                    items={[{ label: 'Remove', onSelect: () => mutate(r.player_id, 'DELETE'), disabled: busy, danger: true }]}
                  />
                </div>
              )}
            </RosterPlayerRow>
          );
        })
      )}
      <ErrorText error={error} size={12} className="px-4 pb-3" />
    </div>
  );
}
