// TEMPORARY — ground-truth check for the #491 damage side-split investigation. Reads several
// candidate damage netprops directly at each round-end tick (bypassing collectAccumulators()
// entirely): m_iDamage (what accumulators.ts currently reads, assumed cumulative across the match)
// alongside m_flTotalRoundDamageDealt and CSPerRoundStats_t.m_iDamage (whose scope, cumulative vs.
// reset-per-round, isn't yet confirmed). Prints raw values every round so the trajectory itself
// (monotonic vs. sawtooth) settles which behavior each has, then computes both a delta-based total
// (for cumulative-looking props) and a plain sum-of-raw-values total (for per-round-looking props)
// so either can be compared against the known m_iDamage-based match total. Delete before merging.
//
// Needs Cloudflare R2 creds in env:
//   set -a; . ./.env.local; set +a
//   tsx scripts/dump-raw-damage-accumulator.ts --match 71

import { parseEvent, parseTicks } from '@laihoe/demoparser2';
import { gunzipMaybe } from '../src/lib/gzip';
import { parseArgs, die, loadDemoFromR2 } from './inspect-demo-shared';
import { readDemoPlayers, resolveRoster } from '../src/lib/parsers/rosterResolver';
import { getReplayInputs } from '../src/lib/replay/inputs';
import { getAdminClient } from '../src/lib/supabase-admin';
import { buildRoundSides, resolveSide } from '../src/lib/parsers/roundSides';

const NS = 'CCSPlayerController.CCSPlayerController_ActionTrackingServices';
const PROPS = [
  `${NS}.m_iDamage`,
  `${NS}.m_flTotalRoundDamageDealt`,
  `${NS}.CSPerRoundStats_t.m_iDamage`,
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.match !== 'string') die('Usage: tsx scripts/dump-raw-damage-accumulator.ts --match <id>');
  const matchId = Number(args.match);

  const admin = getAdminClient();
  const inputs = await getReplayInputs(admin, matchId);

  const rawBuf = await loadDemoFromR2(matchId);
  const demoBuffer = gunzipMaybe(rawBuf);

  const demoPlayers = readDemoPlayers(demoBuffer);
  const warnings: string[] = [];
  const steamToPlayer = resolveRoster(demoPlayers, inputs.roster, warnings);
  if (warnings.length > 0) console.log('roster warnings:', warnings);

  const roundEndRows = parseEvent(demoBuffer, 'round_end', [], [
    'total_rounds_played', 'winner', 'is_warmup_period', 'reason',
  ]) as {
    tick: number; total_rounds_played: number; winner: string | null;
    is_warmup_period: boolean | number; reason: string | null;
  }[];

  const rounds = buildRoundSides(roundEndRows, inputs.skinsSide, inputs.targetWinRounds, 0);
  console.log(`\n=== raw damage netprop trajectories: match ${matchId} ===`);
  console.log(`live rounds: ${rounds.length}, skinsSide=${inputs.skinsSide}, targetWinRounds=${inputs.targetWinRounds}\n`);

  const endTicks = rounds.map((r) => r.endTick);
  const rows = parseTicks(demoBuffer, PROPS, endTicks) as Record<string, unknown>[];
  // tick -> steamid -> prop -> value
  const byTickAndSteam = new Map<number, Map<string, Map<string, number>>>();
  for (const row of rows) {
    const tick = row.tick as number;
    const sid = String(row.steamid ?? '');
    if (!byTickAndSteam.has(tick)) byTickAndSteam.set(tick, new Map());
    const bySteam = byTickAndSteam.get(tick)!;
    if (!bySteam.has(sid)) bySteam.set(sid, new Map());
    const byProp = bySteam.get(sid)!;
    for (const prop of PROPS) byProp.set(prop, (row[prop] as number) ?? 0);
  }

  for (const [steamId, entry] of steamToPlayer) {
    console.log(`\n-- player_id ${entry.player_id} (${entry.faction}), steamid ${steamId} --`);
    console.log(`round  shirtsSide  playerSide  | ${PROPS.map((p) => p.replace(NS + '.', '')).join('  |  ')}`);
    const prev = new Map<string, number>(PROPS.map((p) => [p, 0]));
    const deltaTotal = new Map<string, { ct: number; t: number }>(PROPS.map((p) => [p, { ct: 0, t: 0 }]));
    const sumTotal = new Map<string, { ct: number; t: number }>(PROPS.map((p) => [p, { ct: 0, t: 0 }]));

    for (const r of rounds) {
      const byProp = byTickAndSteam.get(r.endTick)?.get(steamId);
      const side = resolveSide(r.shirtsSide, entry.faction);
      const cells: string[] = [];
      for (const prop of PROPS) {
        const raw = byProp?.get(prop) ?? 0;
        const delta = raw - (prev.get(prop) ?? 0);
        prev.set(prop, raw);
        const dt = deltaTotal.get(prop)!;
        const st = sumTotal.get(prop)!;
        if (side === 'CT') { dt.ct += delta; st.ct += raw; } else { dt.t += delta; st.t += raw; }
        cells.push(`raw=${raw} delta=${delta}`);
      }
      console.log(
        `${String(r.roundNumber).padStart(5)}  ${r.shirtsSide.padStart(10)}  ${side.padStart(10)}  | ${cells.join('  |  ')}`,
      );
    }
    for (const prop of PROPS) {
      const dt = deltaTotal.get(prop)!;
      const st = sumTotal.get(prop)!;
      console.log(
        `  ${prop.replace(NS + '.', '')}: delta-based ct=${dt.ct} t=${dt.t} total=${dt.ct + dt.t}  |  ` +
          `sum-of-raw ct=${st.ct} t=${st.t} total=${st.ct + st.t}`,
      );
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
