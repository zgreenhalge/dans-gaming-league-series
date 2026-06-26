// Generate a MatchZy match-config JSON for a DGLS match (Phase 4 head start; useful tomorrow to
// avoid hand-authoring the config). Prints the config to stdout; warnings to stderr.
//
//   set -a; . ./.env.local; set +a
//   tsx scripts/gen-matchzy-config.ts <matchId> > match.json
//
// What it encodes (per dathost_handoff/DATHOST_PHASE0_PLAN.md):
//   - matchid          = the DGLS match_id (MatchZy stamps the demo with it → self-labels for R2)
//   - team1 / team2    = SHIRTS / SKINS players keyed by steamid64
//   - players_per_team = 2 (Wingman)
//   - maplist          = the picked workshop map
//   - map_sides        = conditional: skins_starting_side stored → forced side, else ["knife"]
//   - cvars            = demo upload URL + auth header (from env, else placeholders)
//
// Env (optional, for the upload cvars): INGEST_WORKER_URL, INGEST_UPLOAD_SECRET.
// Read-only against Supabase.

import { getReplayInputs } from '../src/lib/replay/inputs';
import { getAdminClient } from '../src/lib/supabase-admin';
import type { RosterEntry } from '../src/lib/demoParser';

/** Which team is CT, given which side SKINS (team2) starts on. */
function mapSides(skinsSide: 'CT' | 'T' | null): string[] {
  if (skinsSide === 'CT') return ['team2_ct']; // skins start CT
  if (skinsSide === 'T') return ['team1_ct']; // skins start T ⇒ shirts CT
  return ['knife']; // unknown at config time (gauntlet/playoff) — knife decides, backfill the side later
}

function playersOf(roster: RosterEntry[], faction: 'SHIRTS' | 'SKINS'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of roster) {
    if (p.faction !== faction) continue;
    if (!p.steam_id) continue; // missing steamid64 — can't place this player (warned below)
    out[p.steam_id] = p.steam_nickname || p.name;
  }
  return out;
}

async function main() {
  const matchId = Number(process.argv[2]);
  if (!Number.isInteger(matchId) || matchId <= 0) {
    console.error('usage: tsx scripts/gen-matchzy-config.ts <matchId>');
    process.exit(1);
  }

  const inputs = await getReplayInputs(getAdminClient(), matchId);

  // Warn about anything that would make the config wrong rather than silently emitting it.
  const missing = inputs.roster.filter((r) => !r.steam_id).map((r) => `${r.faction}:${r.name}`);
  if (missing.length) {
    console.error(`⚠ ${missing.length} player(s) without a steam_id — omitted from teams: ${missing.join(', ')}`);
  }
  if (inputs.skinsSide === null) {
    console.error('⚠ skins_starting_side not set — emitting map_sides ["knife"]; backfill the side before parsing.');
  }
  if (!inputs.map) {
    console.error('⚠ match has no picked map — maplist will be empty; set picked_map first.');
  } else {
    console.error(`ℹ maplist = ["${inputs.map}"] — confirm this is the workshop map id/name MatchZy expects (workshop maps may need a workshop/<id> form).`);
  }

  const shirts = playersOf(inputs.roster, 'SHIRTS');
  const skins = playersOf(inputs.roster, 'SKINS');

  const config = {
    matchid: matchId,
    num_maps: 1,
    players_per_team: 2,
    maplist: inputs.map ? [inputs.map] : [],
    map_sides: mapSides(inputs.skinsSide),
    clinch_series: true,
    team1: { name: 'SHIRTS', players: shirts },
    team2: { name: 'SKINS', players: skins },
    cvars: {
      matchzy_demo_upload_url: process.env.INGEST_WORKER_URL || 'https://REPLACE_WORKER_URL',
      matchzy_demo_upload_header_key: 'X-MatchZy-Token',
      matchzy_demo_upload_header_value: process.env.INGEST_UPLOAD_SECRET || 'REPLACE_UPLOAD_SECRET',
    },
  };

  console.error(
    `ℹ match ${matchId}: SHIRTS ${Object.keys(shirts).length}p, SKINS ${Object.keys(skins).length}p, ` +
      `map_sides ${JSON.stringify(config.map_sides)} (skinsSide=${inputs.skinsSide ?? 'null'})`,
  );
  process.stdout.write(JSON.stringify(config, null, 2) + '\n');
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
