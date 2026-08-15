// Best-effort Discord role management via Discord's REST API. No gateway connection needed; every
// export here is safe to call unconditionally — missing config, an unlinked player, or an API
// failure never throws into the caller, matching this codebase's other best-effort hooks. A real
// failure (config present but the call itself errors) is recorded to ops_errors — entity 'player' —
// so it's visible in the admin console's Activity feed instead of only a Vercel function log nobody's
// tailing; cleared automatically the next sync that succeeds for that player. Two independent pieces
// live here:
//
// - @Participants (#397): grants/revokes a single shared guild role (PUT/DELETE guild member role),
//   tracking active-season roster membership.
// - Name-color roles: a per-player cosmetic role named after the player's DGLS name, created at link
//   time and positioned directly below the bot's own top role (so its color actually shows), kept in
//   sync on rename, and deleted on unlink. `players.discord_name_role_id` is the id. Color itself is
//   set by the player via the `/name-color` slash command (`discord-commands.ts`), not from here.

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordOpsError, clearOpsError } from './ops-errors';
import { getActiveRegularSeason, getSeasonRoster } from './queries';

const OPERATION = 'discord_role_sync';
const NAME_ROLE_OPERATION = 'discord_name_role_sync';

async function setGuildMemberRole(
  supabaseAdmin: SupabaseClient,
  playerId: number,
  discordId: string,
  grant: boolean,
): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  const roleId = process.env.DISCORD_PARTICIPANTS_ROLE_ID;
  if (!token || !guildId || !roleId) return;

  const action = grant ? 'grant' : 'revoke';
  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}/roles/${roleId}`,
      { method: grant ? 'PUT' : 'DELETE', headers: { Authorization: `Bot ${token}` } },
    );
    // A 404 here means the player isn't (or is no longer) a member of the guild — not a failure
    // worth surfacing, since there's nothing this sync could have done differently.
    if (!res.ok && res.status !== 404) {
      await recordOpsError(supabaseAdmin, 'player', playerId, OPERATION, `${action} returned ${res.status}`);
      return;
    }
    await clearOpsError(supabaseAdmin, 'player', playerId, OPERATION);
  } catch (e) {
    await recordOpsError(supabaseAdmin, 'player', playerId, OPERATION, `${action} failed: ${(e as Error).message}`);
  }
}

/** Grants @Participants to one player, resolved by their linked discord_id. No-op if unlinked. */
export async function grantParticipantRole(
  supabaseAdmin: SupabaseClient,
  playerId: number,
  discordId: string | null,
): Promise<void> {
  if (discordId) await setGuildMemberRole(supabaseAdmin, playerId, discordId, true);
}

/** Revokes @Participants from one player, resolved by their linked discord_id. No-op if unlinked. */
export async function revokeParticipantRole(
  supabaseAdmin: SupabaseClient,
  playerId: number,
  discordId: string | null,
): Promise<void> {
  if (discordId) await setGuildMemberRole(supabaseAdmin, playerId, discordId, false);
}

export interface RosterRoleEntry {
  player_id: number;
  discord_id: string | null;
}

/** Grants @Participants to every linked player on a roster — the "go live" catch-up pass, covering
 *  anyone who linked Discord after already being added to the roster (their individual add-hook
 *  would have been a no-op at the time, since discord_id was still null then). Unlinked players are
 *  silently skipped, same as the single-player path. */
export async function grantParticipantRoleToRoster(supabaseAdmin: SupabaseClient, roster: RosterRoleEntry[]): Promise<void> {
  await Promise.all(roster.map((r) => grantParticipantRole(supabaseAdmin, r.player_id, r.discord_id)));
}

/** Revokes @Participants from every linked player on a roster — the season-completion pass. */
export async function revokeParticipantRoleFromRoster(supabaseAdmin: SupabaseClient, roster: RosterRoleEntry[]): Promise<void> {
  await Promise.all(roster.map((r) => revokeParticipantRole(supabaseAdmin, r.player_id, r.discord_id)));
}

/** Reconciles one player's @Participants membership against whether they're on the current ACTIVE
 *  regular season's roster right now. The functions above are all roster-event-driven (grant/revoke
 *  fires when *roster membership* changes); this covers the other direction — a player linking
 *  Discord after already being rostered, who would otherwise never get the role until some later
 *  roster event happened to touch them. Call this after writing a new (non-null) `discord_id` —
 *  self-service OAuth link or an admin override. Deliberately one-directional: unlinking Discord
 *  never revokes the role, since roster membership (not having a linked account) is what makes a
 *  player a participant — a player can be rostered and active without ever linking Discord. No-op if
 *  `discordId` is null. */
export async function syncParticipantRoleForPlayer(
  supabaseAdmin: SupabaseClient,
  playerId: number,
  discordId: string | null,
): Promise<void> {
  if (!discordId) return;
  const activeSeason = await getActiveRegularSeason();
  const onActiveRoster = activeSeason
    ? (await getSeasonRoster(activeSeason.id)).some((r) => r.player_id === playerId)
    : false;
  if (onActiveRoster) {
    await grantParticipantRole(supabaseAdmin, playerId, discordId);
  } else {
    await revokeParticipantRole(supabaseAdmin, playerId, discordId);
  }
}

/** The bot's own highest role position in the guild's hierarchy — a name-color role must sit below
 *  this (Discord refuses to let a bot manage a role at or above its own top role), and positioning it
 *  directly below is what puts it "at the top" among the ordinary member roles it needs to outrank
 *  for its color to show. `null` if any of the three calls this takes (resolve the bot's own user id,
 *  its guild member roles, the guild's role list) fails. */
async function getBotTopRolePosition(guildId: string, token: string): Promise<number | null> {
  const headers = { Authorization: `Bot ${token}` };
  const meRes = await fetch('https://discord.com/api/v10/users/@me', { headers });
  if (!meRes.ok) return null;
  const me = (await meRes.json()) as { id: string };

  const [memberRes, rolesRes] = await Promise.all([
    fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${me.id}`, { headers }),
    fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers }),
  ]);
  if (!memberRes.ok || !rolesRes.ok) return null;
  const member = (await memberRes.json()) as { roles: string[] };
  const roles = (await rolesRes.json()) as { id: string; position: number }[];
  const positions = roles.filter((r) => member.roles.includes(r.id)).map((r) => r.position);
  return positions.length > 0 ? Math.max(...positions) : null;
}

/** Creates this player's cosmetic name-color role — named after their current DGLS name, positioned
 *  directly below the bot's own top role, and assigned to their Discord member — storing its id in
 *  `players.discord_name_role_id`. No-ops without full config, without a `discordId`, or if the
 *  player already has a role recorded (idempotent, so a retry or a repeat backfill pass can't create
 *  duplicates). Call this after writing a new (non-null) `discord_id` — self-service OAuth link or an
 *  admin override — same trigger point as `syncParticipantRoleForPlayer`. */
export async function createNameRole(
  supabaseAdmin: SupabaseClient,
  playerId: number,
  discordId: string | null,
  playerName: string,
): Promise<void> {
  if (!discordId) return;
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !guildId) return;

  const { data: existing } = await supabaseAdmin
    .from('players')
    .select('discord_name_role_id')
    .eq('id', playerId)
    .maybeSingle();
  if ((existing as { discord_name_role_id?: string | null } | null)?.discord_name_role_id) return;

  const headers = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' };
  try {
    const createRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: playerName }),
    });
    if (!createRes.ok) {
      await recordOpsError(supabaseAdmin, 'player', playerId, NAME_ROLE_OPERATION, `role create returned ${createRes.status}`);
      return;
    }
    const role = (await createRes.json()) as { id: string };

    // Best-effort: a failed reposition still leaves a usable (if potentially low-priority) role
    // rather than losing the role entirely, so it doesn't gate the rest of this function.
    const topPosition = await getBotTopRolePosition(guildId, token);
    if (topPosition != null && topPosition > 0) {
      await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify([{ id: role.id, position: Math.max(1, topPosition - 1) }]),
      });
    }

    const assignRes = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}/roles/${role.id}`,
      { method: 'PUT', headers },
    );
    if (!assignRes.ok && assignRes.status !== 404) {
      await recordOpsError(supabaseAdmin, 'player', playerId, NAME_ROLE_OPERATION, `role assign returned ${assignRes.status}`);
      return;
    }

    await supabaseAdmin.from('players').update({ discord_name_role_id: role.id }).eq('id', playerId);
    await clearOpsError(supabaseAdmin, 'player', playerId, NAME_ROLE_OPERATION);
  } catch (e) {
    await recordOpsError(supabaseAdmin, 'player', playerId, NAME_ROLE_OPERATION, `create failed: ${(e as Error).message}`);
  }
}

/** Renames this player's name-color role to match a new DGLS name. No-op without full config or a
 *  `roleId` (never linked, or linked before this feature existed and not yet backfilled). */
export async function renameNameRole(
  supabaseAdmin: SupabaseClient,
  playerId: number,
  roleId: string | null,
  newName: string,
): Promise<void> {
  if (!roleId) return;
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !guildId) return;

  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles/${roleId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    // A 404 here means the role is already gone (e.g. deleted out of band) — not a failure worth
    // surfacing, same reasoning as the @Participants member-role 404 above.
    if (!res.ok && res.status !== 404) {
      await recordOpsError(supabaseAdmin, 'player', playerId, NAME_ROLE_OPERATION, `rename returned ${res.status}`);
      return;
    }
    await clearOpsError(supabaseAdmin, 'player', playerId, NAME_ROLE_OPERATION);
  } catch (e) {
    await recordOpsError(supabaseAdmin, 'player', playerId, NAME_ROLE_OPERATION, `rename failed: ${(e as Error).message}`);
  }
}

/** Deletes this player's name-color role from Discord — called on unlink, since the role only makes
 *  sense while the player's Discord account is linked. No-op without full config or a `roleId`.
 *  Clearing `players.discord_name_role_id` itself is the caller's job, alongside clearing
 *  `discord_id` in the same update — this only ever touches Discord. */
export async function deleteNameRole(
  supabaseAdmin: SupabaseClient,
  playerId: number,
  roleId: string | null,
): Promise<void> {
  if (!roleId) return;
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !guildId) return;

  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles/${roleId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok && res.status !== 404) {
      await recordOpsError(supabaseAdmin, 'player', playerId, NAME_ROLE_OPERATION, `delete returned ${res.status}`);
      return;
    }
    await clearOpsError(supabaseAdmin, 'player', playerId, NAME_ROLE_OPERATION);
  } catch (e) {
    await recordOpsError(supabaseAdmin, 'player', playerId, NAME_ROLE_OPERATION, `delete failed: ${(e as Error).message}`);
  }
}

export interface SetRoleColorResult {
  ok: boolean;
  error?: string;
}

/** Sets a Discord role's color — the mutation behind the `/name-color` slash command. Unlike the rest
 *  of this file, this returns a result instead of recording to `ops_errors`: it runs synchronously
 *  inside the interaction's 3-second budget, and the caller reports success/failure straight back to
 *  the player in the command's own reply, which is visibility enough. */
export async function setDiscordRoleColor(roleId: string, color: number): Promise<SetRoleColorResult> {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !guildId) return { ok: false, error: 'Discord role management is not configured.' };

  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles/${roleId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ color }),
    });
    if (!res.ok) return { ok: false, error: `Discord API returned ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export interface NameRoleBackfillResult {
  attempted: number;
}

/** Creates name-color roles for every linked player who doesn't have one yet — the catch-up pass for
 *  players who linked Discord before this feature existed (`createNameRole()` only ever fires from
 *  the link flow itself, so it was a no-op for everyone who linked earlier). Safe to re-run: only
 *  players with `discord_id` set and `discord_name_role_id` still null are selected, and
 *  `createNameRole()` itself is idempotent. */
export async function backfillNameRoles(supabaseAdmin: SupabaseClient): Promise<NameRoleBackfillResult> {
  const { data, error } = await supabaseAdmin
    .from('players')
    .select('id, name, discord_id')
    .not('discord_id', 'is', null)
    .is('discord_name_role_id', null);
  if (error) throw error;

  const players = (data ?? []) as { id: number; name: string; discord_id: string }[];
  await Promise.all(players.map((p) => createNameRole(supabaseAdmin, p.id, p.discord_id, p.name)));
  return { attempted: players.length };
}
