// Discord slash-command definitions (#396) and the registration call that pushes them to the
// application's global command set. Discord does not pick up src/lib/discord-commands.ts's handler
// logic on its own — the command *shape* (name/options) is separate, declared state that only this
// push updates, so it needs re-running whenever DISCORD_COMMANDS changes. Shared by
// scripts/register-discord-commands.ts (local, needs DISCORD_APPLICATION_ID/DISCORD_BOT_TOKEN in
// env) and POST /api/admin/discord/register-commands (same trigger from the admin console, for
// registering against the production bot without a local `.env.local`).

export const DISCORD_COMMANDS = [
  {
    name: 'leaderboard',
    description: 'DGLS season leaderboard',
    options: [
      {
        type: 4, // INTEGER
        name: 'season',
        description: 'Season number (defaults to the current active season)',
        required: false,
      },
    ],
  },
  {
    name: 'scheduled',
    description: "This week's DGLS matches",
  },
  {
    name: 'player',
    description: 'A player\'s DGLS stat card',
    options: [
      {
        type: 3, // STRING
        name: 'name',
        description: 'Player name (defaults to your own linked Discord account)',
        required: false,
      },
    ],
  },
];

export type RegisterDiscordCommandsResult =
  | { ok: true; names: string[] }
  | { ok: false; error: string };

/** PUTs DISCORD_COMMANDS to Discord's global command set — idempotent, safe to call repeatedly.
 *  Global commands can take up to an hour to propagate to clients after registration; there is no
 *  guild-scoped fast path here since DGLS only ever has one Discord server. */
export async function registerDiscordCommands(): Promise<RegisterDiscordCommandsResult> {
  const applicationId = process.env.DISCORD_APPLICATION_ID;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!applicationId || !botToken) {
    return { ok: false, error: 'DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN must be set.' };
  }

  const res = await fetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(DISCORD_COMMANDS),
  });
  if (!res.ok) {
    return { ok: false, error: `Discord API returned ${res.status}: ${await res.text()}` };
  }

  const registered = (await res.json()) as { name: string }[];
  return { ok: true, names: registered.map((c) => c.name) };
}
