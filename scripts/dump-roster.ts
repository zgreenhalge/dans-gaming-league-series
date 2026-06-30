// Dump a match's RosterEntry[] (via the shared `getReplayInputs` resolver) as JSON, to feed
// `scripts/parse-demo-parity.ts`. Prints the roster array to stdout; prints map / skinsSide /
// targetWinRounds to stderr so you know which `--skins-side` to pass the harness.
//
// Needs Supabase creds in env (source .env.local first):
//   set -a; . ./.env.local; set +a
//   tsx scripts/dump-roster.ts 33 > roster.json
//
// Read-only — no writes.

import { getReplayInputs } from '../src/lib/replay/inputs';
import { getAdminClient } from '../src/lib/supabase-admin';

async function main() {
  const matchId = Number(process.argv[2]);
  if (!Number.isFinite(matchId)) {
    console.error('usage: tsx scripts/dump-roster.ts <matchId>');
    process.exit(1);
  }
  const inputs = await getReplayInputs(getAdminClient(), matchId);
  console.error(
    `match ${matchId}: map=${inputs.map}  skinsSide=${inputs.skinsSide ?? 'null'}  ` +
      `targetWinRounds=${inputs.targetWinRounds}  players=${inputs.roster.length}`,
  );
  process.stdout.write(JSON.stringify(inputs.roster, null, 2) + '\n');
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
