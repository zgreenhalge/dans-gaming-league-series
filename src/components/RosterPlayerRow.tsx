import { useState, type ReactNode } from 'react';
import type { AdminMenuItem } from './AdminMenu';
import { PlayerLink } from './PlayerLink';
import PlayerAvatar from './PlayerAvatar';
import { PlayerName } from './PlayerName';
import { SELECT_CLS } from './formStyles';

// The pieces a signup list is built from — a season roster (`SeasonRosterPanel`) and a scrim night's
// signups (`ScrimNightRoster`): a player row with room for row actions, and the admin's "add a player"
// select (inside each panel's header `AdminMenu`) with the `useAddPlayerMenuItem()` item that wraps it.

/** One player in a signup list: avatar + name linking to their profile, then `children` (row actions)
 *  on the right. */
export function RosterPlayerRow({
  playerId,
  name,
  avatarUrl,
  isMe,
  children,
}: {
  playerId: number;
  name: string;
  avatarUrl: string | null;
  isMe: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="lift-row flex items-center justify-between gap-3 px-4 py-2.5 border-b border-[var(--color-border-tertiary)] last:border-b-0">
      <PlayerLink playerId={playerId} className="flex items-center gap-3 min-w-0">
        <PlayerAvatar name={name} imageUrl={avatarUrl} size="sm" />
        <span className="font-display text-[14px] font-semibold truncate">
          <PlayerName name={name} isMe={isMe} />
        </span>
      </PlayerLink>
      {children}
    </div>
  );
}

/** The admin's "add a player" select: every player not in `excludeIds`, by name. `value` is the
 *  picked player's id as a string, `''` for none. */
export function AddPlayerSelect({
  players,
  excludeIds,
  value,
  onChange,
  placeholder,
}: {
  players: { id: number; name: string }[];
  excludeIds: Set<number>;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const options = players.filter((p) => !excludeIds.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={placeholder}
      className={`${SELECT_CLS} flex-1 min-w-[160px]`}
    >
      <option value="">{placeholder}</option>
      {options.map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  );
}

/** One button beside the picker in an "Add player…" item. `activeCls` styles it once a player is picked,
 *  `idleCls` until then. */
export interface AddPlayerAction {
  label: string;
  onAdd: (playerId: number) => void;
  activeCls: string;
  idleCls: string;
}

/** The header `AdminMenu`'s "Add player…" item, shared by `SeasonRosterPanel` and `ScrimNightRoster`:
 *  it expands into an `AddPlayerSelect` plus one button per `actions` entry, which adds the picked
 *  player, clears the pick and closes the menu. The pick lives here so it survives the menu closing,
 *  and is dropped once that player lands in `excludeIds` by some other route. `busy` holds the buttons
 *  while a write is in flight. */
export function useAddPlayerMenuItem({
  players,
  excludeIds,
  placeholder,
  actions,
  busy,
}: {
  players: { id: number; name: string }[];
  excludeIds: Set<number>;
  placeholder: string;
  actions: AddPlayerAction[];
  busy: boolean;
}): AdminMenuItem {
  const [pickedPlayerId, setPickedPlayerId] = useState('');
  const addPlayerId = excludeIds.has(Number(pickedPlayerId)) ? '' : pickedPlayerId;
  return {
    label: 'Add player…',
    content: (close) => (
      <div className="flex flex-wrap items-center gap-2">
        <AddPlayerSelect players={players} excludeIds={excludeIds} value={addPlayerId} onChange={setPickedPlayerId} placeholder={placeholder} />
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => {
              const playerId = Number(addPlayerId);
              setPickedPlayerId('');
              close();
              a.onAdd(playerId);
            }}
            disabled={!addPlayerId || busy}
            className={addPlayerId ? a.activeCls : a.idleCls}
          >
            {a.label}
          </button>
        ))}
      </div>
    ),
  };
}
