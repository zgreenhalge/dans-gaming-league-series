'use client';

import { useState } from 'react';
import ErrorText from './ErrorText';
import { AddPlayerSelect, RosterPlayerRow } from './RosterPlayerRow';
import { AdminMenu, type AdminMenuItem } from './AdminMenu';
import { ArmedConfirmButton } from './ArmedConfirmButton';
import { ACTIVE_COMMITMENT_BTN_CLS, COMMITMENT_LABEL, IDLE_COMMITMENT_BTN_CLS } from './ScrimCommitmentButtons';
import { useScrimSignupWrite } from './useScrimSignupWrite';
import { StatusPill } from './StatusPill';
import type { ScrimSignupEntry } from '@/lib/queries';
import { SCRIM_COMMITMENTS, type ScrimCommitment } from '@/lib/scrim-schedule';

interface Props {
  nightId: number;
  signups: ScrimSignupEntry[];
  /** Whether players can check in (`isScrimCheckInOpen()`): the row menus offer Check in / Check out. */
  checkInOpen: boolean;
  currentPlayerId: number | null;
  /** Show the admin menus. The caller passes `true` only for an admin, while the night isn't over. */
  admin: boolean;
  /** Every player, for the admin's Add player… picker (empty for anyone else). */
  allPlayers: { id: number; name: string }[];
  /** An Attendance header that folds the lists away (on `/scrims`); otherwise they're always shown. */
  collapsible?: boolean;
}

/** A scrim night's attendance: who's signed up, split into Definite and Maybe, with a "Here" pill on
 *  whoever has checked in, under an Attendance header with the count. An admin gets `AdminMenu`s: one on
 *  each row (check in or out while check-in is open, switch between definite and maybe, remove — which
 *  asks for a confirm for the night's only player, whose removal deletes the night) and one on the header
 *  (Add player…, which opens the player picker in the menu). */
export function ScrimNightRoster({ nightId, signups, checkInOpen, currentPlayerId, admin, allPlayers, collapsible = false }: Props) {
  const { busy, error, pending, setCommitment, setCheckIn } = useScrimSignupWrite(nightId);
  const [pickedPlayerId, setPickedPlayerId] = useState('');
  // The picker keeps its pick while the menu is closed, until that player signs up some other way.
  const addPlayerId = signups.some((s) => String(s.player_id) === pickedPlayerId) ? '' : pickedPlayerId;
  const [open, setOpen] = useState(true);
  const shown = open || !collapsible;

  /** An admin's actions on one player's signup, held while any signup write is in flight. */
  function rowItems(s: ScrimSignupEntry, other: ScrimCommitment): AdminMenuItem[] {
    // The night's only player: removing them deletes the night unless it has matches (`leave_scrim_night()`).
    const remove: AdminMenuItem =
      signups.length === 1
        ? {
            label: 'Remove…',
            danger: true,
            disabled: busy,
            content: () => (
              <div className="flex flex-col gap-2">
                <p className="font-mono text-[11px] text-[var(--color-text-secondary)]">
                  {s.player_name} is the only player signed up, so removing them deletes the night unless it has matches.
                </p>
                <ArmedConfirmButton
                  onConfirm={() => setCommitment(s.player_id, null)}
                  busy={busy}
                  error={error}
                  triggerLabel="Remove"
                  confirmLabel="Confirm remove"
                  busyLabel="Removing…"
                  variant="danger"
                />
              </div>
            ),
          }
        : { label: 'Remove', onSelect: () => setCommitment(s.player_id, null), disabled: busy, danger: true };
    return [
      ...(checkInOpen
        ? [{ label: s.checked_in_at ? 'Check out' : 'Check in', onSelect: () => setCheckIn(s.player_id, !s.checked_in_at), disabled: busy }]
        : []),
      { label: `Make ${COMMITMENT_LABEL[other].toLowerCase()}`, onSelect: () => setCommitment(s.player_id, other), disabled: busy },
      remove,
    ];
  }

  /** The night's admin actions: Add player… opens the player picker in the menu. */
  const nightItems: AdminMenuItem[] = [
    {
      label: 'Add player…',
      content: (close) => (
        <div className="flex flex-wrap items-center gap-2">
          <AddPlayerSelect
            players={allPlayers}
            excludeIds={new Set(signups.map((s) => s.player_id))}
            value={addPlayerId}
            onChange={setPickedPlayerId}
            placeholder="Sign up a player…"
          />
          {SCRIM_COMMITMENTS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                const playerId = Number(addPlayerId);
                setPickedPlayerId('');
                close();
                setCommitment(playerId, c);
              }}
              disabled={!addPlayerId || pending != null}
              className={addPlayerId ? ACTIVE_COMMITMENT_BTN_CLS[c] : IDLE_COMMITMENT_BTN_CLS}
            >
              Add as {COMMITMENT_LABEL[c].toLowerCase()}
            </button>
          ))}
        </div>
      ),
    },
  ];

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
                {admin && <AdminMenu label={`Admin actions for ${s.player_name}`} items={rowItems(s, other)} />}
              </div>
            </RosterPlayerRow>
          ))}
        </div>
      </div>
    );
  }

  const headerCls = 'flex-1 text-left px-4 py-2 tracked text-[10px] text-[var(--color-text-secondary)]';
  return (
    <div>
      {/* The toggle and the admin menu sit side by side, so neither button holds the other. */}
      <div className="flex items-center gap-2 pr-2 border-b border-[var(--color-border-tertiary)]">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className={`${headerCls} hover:text-[var(--color-text-primary)] transition-colors`}
          >
            {open ? '▾' : '▸'} Attendance · {signups.length}
          </button>
        ) : (
          <div className={headerCls}>Attendance · {signups.length}</div>
        )}
        {admin && <AdminMenu label="Attendance admin actions" items={nightItems} />}
      </div>
      {shown && SCRIM_COMMITMENTS.map(group)}
      <ErrorText error={error} size={12} className="px-4 py-3" />
    </div>
  );
}
