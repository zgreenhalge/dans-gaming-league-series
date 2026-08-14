// Registers (or re-registers) DGLS's Discord slash commands against the application's global
// command set. Run this once after creating the commands or whenever their definitions change —
// Discord does not pick up src/lib/discord-commands.ts's handler logic on its own; the command
// *shape* (name/options) is separate, declared state that only this script pushes.
//
// Needs DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN in env (source .env.local first):
//   set -a; . ./.env.local; set +a
//   npx tsx scripts/register-discord-commands.ts
//
// Global commands can take up to an hour to propagate to clients after registration; there is no
// guild-scoped fast path configured here since DGLS only ever has one Discord server.

const COMMANDS = [
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

async function main() {
  const applicationId = process.env.DISCORD_APPLICATION_ID;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!applicationId || !botToken) {
    console.error('DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN must be set.');
    process.exit(1);
  }

  const res = await fetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(COMMANDS),
  });

  if (!res.ok) {
    console.error(`Discord API returned ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  const registered = (await res.json()) as { name: string }[];
  console.log(`Registered ${registered.length} command(s): ${registered.map((c) => c.name).join(', ')}`);
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
