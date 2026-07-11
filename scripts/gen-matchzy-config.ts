// Generate a MatchZy match-config JSON for a DGLS match (Phase 4 head start; useful to avoid
// hand-authoring the config). Prints the config to stdout; warnings to stderr.
//
//   set -a; . ./.env.local; set +a
//   tsx scripts/gen-matchzy-config.ts <matchId> > match.json
//
// The config shape lives in `src/lib/matchzy.ts` (shared with the `matchzy-config` route).
// Env (optional, for the upload/remote-log cvars): INGEST_WORKER_URL, INGEST_UPLOAD_SECRET,
// APP_BASE_URL, INGEST_REMOTE_LOG_SECRET.
// Read-only against Supabase.

import { buildMatchzyConfig } from '../src/lib/matchzy';
import { getAdminClient } from '../src/lib/supabase-admin';

async function main() {
  const matchId = Number(process.argv[2]);
  if (!Number.isInteger(matchId) || matchId <= 0) {
    console.error('usage: tsx scripts/gen-matchzy-config.ts <matchId>');
    process.exit(1);
  }

  const { config, warnings } = await buildMatchzyConfig(getAdminClient(), matchId, {
    demoUploadUrl: process.env.INGEST_WORKER_URL,
    demoUploadSecret: process.env.INGEST_UPLOAD_SECRET,
    remoteLogUrl:
      process.env.APP_BASE_URL && process.env.INGEST_REMOTE_LOG_SECRET
        ? `${process.env.APP_BASE_URL}/api/ingest/matchzy-log`
        : undefined,
    remoteLogSecret: process.env.INGEST_REMOTE_LOG_SECRET,
  });

  for (const w of warnings) console.error(`⚠ ${w}`);
  console.error(
    `ℹ match ${matchId}: SHIRTS ${Object.keys(config.team1.players).length}p, ` +
      `SKINS ${Object.keys(config.team2.players).length}p, map_sides ${JSON.stringify(config.map_sides)}`,
  );
  process.stdout.write(JSON.stringify(config, null, 2) + '\n');
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
