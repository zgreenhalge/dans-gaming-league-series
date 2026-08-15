// Creates Discord name-color roles for every player who linked Discord before the name-role feature
// existed (createNameRole() only ever fires from the link flow itself, so it never touched anyone
// who linked earlier). Safe to re-run — only players with discord_id set and discord_name_role_id
// still null are touched, and createNameRole() itself is idempotent.
//
// Needs Supabase creds plus DISCORD_BOT_TOKEN/DISCORD_GUILD_ID in env (source .env.local first):
//   set -a; . ./.env.local; set +a
//   npx tsx scripts/backfill-discord-name-roles.ts
//
// Without a local environment with those vars set, use the same trigger from the admin console
// instead: Manage → the "Backfill name-color roles" button, which runs against the production bot.

import { backfillNameRoles } from '../src/lib/discord-roles';
import { getAdminClient } from '../src/lib/supabase-admin';

async function main() {
  const result = await backfillNameRoles(getAdminClient());
  console.log(`Attempted ${result.attempted} player(s). Check the admin console's Activity feed for any that failed.`);
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
