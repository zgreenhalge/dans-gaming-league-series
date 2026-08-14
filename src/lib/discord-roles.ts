// Best-effort Discord @Participants role sync (#397) — grants/revokes a single guild role per
// player via Discord's REST API (PUT/DELETE guild member role). No gateway connection needed;
// every export here is safe to call unconditionally — missing config, an unlinked player, or an
// API failure never throws into the caller, matching this codebase's other best-effort hooks.

async function setGuildMemberRole(discordId: string, grant: boolean): Promise<void> {
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
    // worth logging, since there's nothing this sync could have done differently.
    if (!res.ok && res.status !== 404) {
      console.error(`[discord-roles] ${action}(${discordId}) returned ${res.status}`);
    }
  } catch (e) {
    console.error(`[discord-roles] ${action}(${discordId}) failed:`, e);
  }
}

/** Grants @Participants to one player, resolved by their linked discord_id. No-op if unlinked. */
export async function grantParticipantRole(discordId: string | null): Promise<void> {
  if (discordId) await setGuildMemberRole(discordId, true);
}

/** Revokes @Participants from one player, resolved by their linked discord_id. No-op if unlinked. */
export async function revokeParticipantRole(discordId: string | null): Promise<void> {
  if (discordId) await setGuildMemberRole(discordId, false);
}

/** Grants @Participants to every linked player on a roster — the "go live" catch-up pass, covering
 *  anyone who linked Discord after already being added to the roster (their individual add-hook
 *  would have been a no-op at the time, since discord_id was still null then). Unlinked players are
 *  silently skipped, same as the single-player path. */
export async function grantParticipantRoleToRoster(discordIds: (string | null)[]): Promise<void> {
  await Promise.all(discordIds.map((id) => grantParticipantRole(id)));
}

/** Revokes @Participants from every linked player on a roster — the season-completion pass. */
export async function revokeParticipantRoleFromRoster(discordIds: (string | null)[]): Promise<void> {
  await Promise.all(discordIds.map((id) => revokeParticipantRole(id)));
}
