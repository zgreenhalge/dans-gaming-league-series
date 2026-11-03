import type { ReactNode } from 'react';
import { PlayerLink } from './PlayerLink';
import PlayerAvatar from './PlayerAvatar';
import { PlayerName } from './PlayerName';
import { SELECT_CLS } from './formStyles';

// The pieces a signup list is built from — a season roster (`SeasonRosterPanel`) and a scrim night's
// signups (`ScrimNightPanel`): a player row with room for row actions, the row's Remove button, and
// the admin's "add a player" select.

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

/** A row's admin "Remove" action. */
export function RosterRemoveButton({ onClick, pending }: { onClick: () => void; pending: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="font-mono text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-red-fg,#f87171)] transition-colors disabled:opacity-40"
    >
      {pending ? '…' : 'Remove'}
    </button>
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
