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
import { getActiveRegularSeason, getSeasonParticipants } from './queries';

const OPERATION = 'discord_role_sync';
const NAME_ROLE_OPERATION = 'discord_name_role_sync';

/** Runs one Discord REST call, recording/clearing `operation`'s `ops_errors` row around it. Returns
 *  the response on success, or `null` once the failure's been recorded, so a caller can
 *  `if (!res) return;` and stop there. The one shared primitive every Discord role mutation in this
 *  file goes through — @Participants grant/revoke and every name-color role step alike.
 *
 *  `tolerate404` (default `true`) treats a 404 as success too — appropriate for a call whose target
 *  may legitimately already be gone (a role being renamed/deleted/assigned, a member who's left the
 *  guild), which isn't a failure worth surfacing since there's nothing the caller could have done
 *  differently. Pass `false` for a call whose target is expected to exist by construction (e.g.
 *  creating a role against a guild id that must be valid) — there a 404 means something is actually
 *  broken (bad config, a deleted guild), not an already-absent target. */
async function discordApiCall(
  supabaseAdmin: SupabaseClient,
  playerId: number,
  operation: string,
  label: string,
  url: string,
  init: RequestInit,
  tolerate404 = true,
): Promise<Response | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok && !(tolerate404 && res.status === 404)) {
      await recordOpsError(supabaseAdmin, 'player', playerId, operation, `${label} returned ${res.status}`);
      return null;
    }
    await clearOpsError(supabaseAdmin, 'player', playerId, operation);
    return res;
  } catch (e) {
    await recordOpsError(supabaseAdmin, 'player', playerId, operation, `${label} failed: ${(e as Error).message}`);
    return null;
  }
}

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

  await discordApiCall(
    supabaseAdmin, playerId, OPERATION, grant ? 'grant' : 'revoke',
    `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}/roles/${roleId}`,
    { method: grant ? 'PUT' : 'DELETE', headers: { Authorization: `Bot ${token}` } },
  );
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
    ? (await getSeasonParticipants(activeSeason.id)).some((r) => r.player_id === playerId)
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

/** Creates this player's cosmetic name-color role — named after their current DGLS name, mentionable
 *  by anyone in the server, positioned directly below the bot's own top role, and assigned to their
 *  Discord member — storing its id in `players.discord_name_role_id`. No-ops without full config,
 *  without a `discordId`, or if the player already has a role recorded (idempotent, so a retry or a
 *  repeat backfill pass can't create duplicates). Call this after writing a new (non-null)
 *  `discord_id` — self-service OAuth link or an admin override — same trigger point as
 *  `syncParticipantRoleForPlayer`.
 *
 *  `topPosition` lets a caller resolving several players in one batch (`backfillNameRoles()`) pass in
 *  the bot's top-role position once for the whole batch instead of every call re-resolving the same
 *  guild-wide, per-player-invariant value — pass it explicit `undefined` (the default) to have this
 *  function resolve it itself, for a standalone call. */
export async function createNameRole(
  supabaseAdmin: SupabaseClient,
  playerId: number,
  discordId: string | null,
  playerName: string,
  topPosition?: number | null,
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
  const createRes = await discordApiCall(
    supabaseAdmin, playerId, NAME_ROLE_OPERATION, 'role create',
    `https://discord.com/api/v10/guilds/${guildId}/roles`,
    { method: 'POST', headers, body: JSON.stringify({ name: playerName, mentionable: true }) },
    false, // a 404 here means bad config (guild gone), not an already-absent target -- must not be tolerated
  );
  if (!createRes) return;
  const role = (await createRes.json()) as { id: string };

  // Best-effort: a failed reposition still leaves a usable (if potentially low-priority) role rather
  // than losing the role entirely, so it doesn't gate the rest of this function.
  const resolvedTopPosition = topPosition !== undefined ? topPosition : await getBotTopRolePosition(guildId, token);
  if (resolvedTopPosition != null && resolvedTopPosition > 0) {
    await discordApiCall(
      supabaseAdmin, playerId, NAME_ROLE_OPERATION, 'role reposition',
      `https://discord.com/api/v10/guilds/${guildId}/roles`,
      { method: 'PATCH', headers, body: JSON.stringify([{ id: role.id, position: Math.max(1, resolvedTopPosition - 1) }]) },
    );
  }

  const assignRes = await discordApiCall(
    supabaseAdmin, playerId, NAME_ROLE_OPERATION, 'role assign',
    `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}/roles/${role.id}`,
    { method: 'PUT', headers },
  );
  if (!assignRes) return;

  // Not a second clearOpsError() here -- the assign discordApiCall() above already cleared it on
  // success, and this is unreachable otherwise (the `if (!assignRes) return;` above).
  await supabaseAdmin.from('players').update({ discord_name_role_id: role.id }).eq('id', playerId);
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

  await discordApiCall(
    supabaseAdmin, playerId, NAME_ROLE_OPERATION, 'rename',
    `https://discord.com/api/v10/guilds/${guildId}/roles/${roleId}`,
    { method: 'PATCH', headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName }) },
  );
}

/** Reads a player's currently-stored name-color role id, if any — the pre-update read every unlink
 *  path needs before nulling `discord_name_role_id`, since the column's post-update value is gone by
 *  the time a caller could otherwise read it. */
export async function getStoredNameRoleId(supabaseAdmin: SupabaseClient, playerId: number): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('players')
    .select('discord_name_role_id')
    .eq('id', playerId)
    .maybeSingle();
  return (data as { discord_name_role_id: string | null } | null)?.discord_name_role_id ?? null;
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

  await discordApiCall(
    supabaseAdmin, playerId, NAME_ROLE_OPERATION, 'delete',
    `https://discord.com/api/v10/guilds/${guildId}/roles/${roleId}`,
    { method: 'DELETE', headers: { Authorization: `Bot ${token}` } },
  );
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

  // The bot's top-role position is guild-wide, not per-player -- resolve it once for the whole batch
  // rather than have every createNameRole() call redo the same three-request lookup.
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  const topPosition = token && guildId ? await getBotTopRolePosition(guildId, token) : null;

  // Sequential, not Promise.all: every player in the batch requests the same "just below the bot"
  // target position, and Discord's reposition endpoint resolves each request against whatever the
  // guild's role order already is -- it has no visibility into other in-flight requests. Firing them
  // concurrently races multiple roles for the same slot, so the final order depends on network timing
  // instead of every role landing directly under the bot as intended. Awaiting each one in turn lets
  // Discord's order settle before the next request reads it, so each new role correctly stacks in
  // just below the bot, pushing the previous batch entries (and everything below them) down by one.
  for (const p of players) {
    await createNameRole(supabaseAdmin, p.id, p.discord_id, p.name, topPosition);
  }
  return { attempted: players.length };
}
