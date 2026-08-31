// TEMPORARY — ground-truth check for the #491 damage side-split investigation. Lists every
// damage/health-related field path demoparser2 actually exposes for this exact demo (via
// listUpdatedFields), then probes specific candidate props at the final round-end tick for all
// roster players: m_iDamage (what accumulators.ts currently reads), m_unTotalRoundDamageDealt, and
// m_matchStats.HealthPointsDealtTotal/HealthPointsRemovedTotal (CS2's own documented gross-damage
// vs. actual-health-removed split, per CounterStrikeSharp's generated schema bindings) -- to see
// whether m_iDamage is the same value as one of these or a genuinely different stat. Delete before
// merging.
//
// Needs Cloudflare R2 creds in env:
//   set -a; . ./.env.local; set +a
//   tsx scripts/compare-damage-netprops.ts --match 71

import { listUpdatedFields, parseEvent, parseTicks } from '@laihoe/demoparser2';
import { gunzipMaybe } from '../src/lib/gzip';
import { parseArgs, die, loadDemoFromR2 } from './inspect-demo-shared';
import { readDemoPlayers, resolveRoster } from '../src/lib/parsers/rosterResolver';
import { getReplayInputs } from '../src/lib/replay/inputs';
import { getAdminClient } from '../src/lib/supabase-admin';
import { buildRoundSides } from '../src/lib/parsers/roundSides';

const NS = 'CCSPlayerController.CCSPlayerController_ActionTrackingServices';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.match !== 'string') die('Usage: tsx scripts/compare-damage-netprops.ts --match <id>');
  const matchId = Number(args.match);

  const admin = getAdminClient();
  const inputs = await getReplayInputs(admin, matchId);

  const rawBuf = await loadDemoFromR2(matchId);
  const demoBuffer = gunzipMaybe(rawBuf);

  const demoPlayers = readDemoPlayers(demoBuffer);
  const warnings: string[] = [];
  const steamToPlayer = resolveRoster(demoPlayers, inputs.roster, warnings);

  console.log(`\n=== damage/health netprop fields available in this demo (match ${matchId}) ===`);
  const fields = listUpdatedFields(demoBuffer);
  const all: string[] = Array.isArray(fields) ? fields : Object.keys(fields ?? {});
  const needles = ['damage', 'health', 'removed', 'dealt'];
  const matches = all.filter((f) => needles.some((n) => String(f).toLowerCase().includes(n)));
  console.log(`${matches.length} matching field(s):`);
  for (const m of matches) console.log(`  ${m}`);

  const roundEndRows = parseEvent(demoBuffer, 'round_end', [], [
    'total_rounds_played', 'winner', 'is_warmup_period', 'reason',
  ]) as {
    tick: number; total_rounds_played: number; winner: string | null;
    is_warmup_period: boolean | number; reason: string | null;
  }[];
  const rounds = buildRoundSides(roundEndRows, inputs.skinsSide, inputs.targetWinRounds, 0);
  const finalTick = rounds[rounds.length - 1].endTick;
  console.log(`\nfinal round-end tick: ${finalTick} (round ${rounds.length})\n`);

  const candidates = [
    `${NS}.m_iDamage`,
    `${NS}.m_unTotalRoundDamageDealt`,
    `${NS}.m_matchStats.HealthPointsDealtTotal`,
    `${NS}.m_matchStats.HealthPointsRemovedTotal`,
    `${NS}.m_matchStats.m_HealthPointsDealtTotal`,
    `${NS}.m_matchStats.m_flHealthPointsDealtTotal`,
  ];

  for (const prop of candidates) {
    console.log(`--- probing "${prop}" ---`);
    try {
      const rows = parseTicks(demoBuffer, [prop], [finalTick]) as Record<string, unknown>[];
      if (rows.length === 0) {
        console.log('  (no rows returned)');
        continue;
      }
      for (const [steamId, entry] of steamToPlayer) {
        const row = rows.find((r) => String(r.steamid ?? '') === steamId);
        console.log(`  player_id ${entry.player_id} (${entry.faction}): ${row ? row[prop] : '(no row for this player)'}`);
      }
    } catch (e) {
      console.log(`  ✖ threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
