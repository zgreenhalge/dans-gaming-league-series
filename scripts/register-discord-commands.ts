// Registers (or re-registers) DGLS's Discord slash commands against the application's global
// command set. Run this once after creating the commands or whenever their definitions
// (src/lib/discord-command-registration.ts) change.
//
// Needs DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN in env (source .env.local first):
//   set -a; . ./.env.local; set +a
//   npx tsx scripts/register-discord-commands.ts
//
// Without a local environment with those vars set, use the same trigger from the admin console
// instead: Manage → the "Register Discord commands" button, which runs against the production bot.

import { registerDiscordCommands } from '../src/lib/discord-command-registration';

async function main() {
  const result = await registerDiscordCommands();
  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }
  console.log(`Registered ${result.names.length} command(s): ${result.names.join(', ')}`);
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
