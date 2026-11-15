// Writes for a player's identity: their display name, Steam link and Discord link — the fields login
// resolution and Discord role sync read. Shared by the routes that change them (`PATCH
// /api/players/[id]`, `PATCH /api/players/me/name`, `GET /api/auth/discord/callback`, `DELETE
// /api/players/me/discord`). The name-history audit write is `player-name-history.ts`, the Discord id
// uniqueness pre-check `discord-link.ts`. Every write throws on failure so the calling route reports it.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { renameFields } from './player-name-history';

export type PlayerUpdate = Database['public']['Tables']['players']['Update'];
type PlayerRow = Database['public']['Tables']['players']['Row'];

/** Thrown when a write is refused because the name, Steam id or Discord id it sets belongs to another
 *  player (the unique indexes on `players`). Its message is the user-facing one. */
export class PlayerIdentityTakenError extends Error {
  constructor(message = 'That name, Steam ID, or Discord ID is already in use by another player.') {
    super(message);
    this.name = 'PlayerIdentityTakenError';
  }
}

/** The error a failed `players` write throws. A unique violation (`23505`) becomes a
 *  `PlayerIdentityTakenError`; any other failure is rethrown as the `Error` the client rejected with. */
function identityWriteError(e: unknown, takenMessage?: string): unknown {
  if ((e as { code?: string } | null)?.code === '23505') return new PlayerIdentityTakenError(takenMessage);
  return e;
}

/** The `players` fields that clear a Discord link together: the id, and the name-color role id that
 *  only makes sense while linked. */
export const DISCORD_UNLINK_FIELDS = { discord_id: null, discord_name_role_id: null } as const;

/** Applies a multi-field edit to one player (the admin edit: name, `is_admin`, Steam link, Discord
 *  link, `seed_ehog`). Returns the updated row, or `null` when no player has that id. Throws
 *  `PlayerIdentityTakenError` when a unique index refuses it. */
export async function updatePlayer(db: SupabaseClient, playerId: number, update: PlayerUpdate): Promise<PlayerRow | null> {
  try {
    const { data } = await db.from('players').update(update).eq('id', playerId).select('*').maybeSingle().throwOnError();
    return data as PlayerRow | null;
  } catch (e) {
    throw identityWriteError(e);
  }
}

/** Renames a player, but only if their last rename is at or before `notChangedSince` (or they have
 *  never renamed) — the once-a-week cooldown, decided inside the write so of two concurrent renames
 *  only the first matches. Returns whether the rename landed. Throws `PlayerIdentityTakenError` for a
 *  name another player holds (the case-insensitive unique index on `lower(name)`). */
export async function renamePlayer(db: SupabaseClient, playerId: number, newName: string, notChangedSince: Date): Promise<boolean> {
  try {
    const { data } = await db
      .from('players')
      .update(renameFields(newName))
      .eq('id', playerId)
      .or(`name_changed_at.is.null,name_changed_at.lte.${notChangedSince.toISOString()}`)
      .select('name')
      .maybeSingle()
      .throwOnError();
    return data != null;
  } catch (e) {
    throw identityWriteError(e, 'That name is already taken.');
  }
}

/** Links a Discord account to a player. Returns the player's `id` and `name`, or `null` when no
 *  player has that id. Throws `PlayerIdentityTakenError` when another player holds the Discord id
 *  (`players_discord_id_key`). */
export async function linkDiscordId(db: SupabaseClient, playerId: number, discordId: string): Promise<{ id: number; name: string } | null> {
  try {
    const { data } = await db
      .from('players')
      .update({ discord_id: discordId })
      .eq('id', playerId)
      .select('id, name')
      .maybeSingle()
      .throwOnError();
    return data as { id: number; name: string } | null;
  } catch (e) {
    throw identityWriteError(e, 'That Discord account is already linked to another player.');
  }
}

/** Clears a player's Discord link and name-color role id (`DISCORD_UNLINK_FIELDS`). */
export async function unlinkDiscordId(db: SupabaseClient, playerId: number): Promise<void> {
  try {
    await db.from('players').update(DISCORD_UNLINK_FIELDS).eq('id', playerId).throwOnError();
  } catch (e) {
    throw identityWriteError(e);
  }
}
