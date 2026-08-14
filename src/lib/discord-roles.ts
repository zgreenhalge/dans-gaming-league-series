// Best-effort Discord @Participants role sync (#397) — grants/revokes a single guild role per
// player via Discord's REST API (PUT/DELETE guild member role). No gateway connection needed;
// every export here is safe to call unconditionally — missing config, an unlinked player, or an
// API failure never throws into the caller, matching this codebase's other best-effort hooks. A
// real failure (config present but the call itself errors) is recorded to ops_errors — entity
// 'player', operation 'discord_role_sync' — so it's visible in the admin console's Activity feed
// instead of only a Vercel function log nobody's tailing; cleared automatically the next sync that
// succeeds for that player.

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordOpsError, clearOpsError } from './ops-errors';

const OPERATION = 'discord_role_sync';

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
