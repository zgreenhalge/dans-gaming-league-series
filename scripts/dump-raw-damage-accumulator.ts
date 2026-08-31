// TEMPORARY — ground-truth check for the #491 damage side-split investigation. Reads the raw
// m_iDamage netprop directly at each round-end tick (bypassing collectAccumulators() entirely) and
// manually recomputes the round-delta/side-split by hand, so a divergence from the stored
// damage_ct/damage_t narrows down whether the bug is in accumulators.ts's loop or in an assumption
// about the netprop itself (e.g. carrying pre-match/warmup damage into round 1's delta). Delete
// before merging.
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
const PROP = `${NS}.m_iDamage`;

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
  console.log(`\n=== raw m_iDamage accumulator: match ${matchId} ===`);
  console.log(`live rounds: ${rounds.length}, skinsSide=${inputs.skinsSide}, targetWinRounds=${inputs.targetWinRounds}\n`);

  const endTicks = rounds.map((r) => r.endTick);
  const rows = parseTicks(demoBuffer, [PROP], endTicks) as Record<string, unknown>[];
  const byTickAndSteam = new Map<number, Map<string, number>>();
  for (const row of rows) {
    const tick = row.tick as number;
    const sid = String(row.steamid ?? '');
    if (!byTickAndSteam.has(tick)) byTickAndSteam.set(tick, new Map());
    byTickAndSteam.get(tick)!.set(sid, (row[PROP] as number) ?? 0);
  }

  for (const [steamId, entry] of steamToPlayer) {
    console.log(`\n-- player_id ${entry.player_id} (${entry.faction}), steamid ${steamId} --`);
    console.log(`round  endTick  shirtsSide  playerSide  raw_m_iDamage  delta`);
    let prev = 0;
    let ctTotal = 0;
    let tTotal = 0;
    for (const r of rounds) {
      const raw = byTickAndSteam.get(r.endTick)?.get(steamId);
      if (raw === undefined) {
        console.log(`${String(r.roundNumber).padStart(5)}  ${String(r.endTick).padStart(7)}  no data at this tick for this player`);
        continue;
      }
      const delta = raw - prev;
      prev = raw;
      const side = resolveSide(r.shirtsSide, entry.faction);
      if (side === 'CT') ctTotal += delta; else tTotal += delta;
      console.log(
        `${String(r.roundNumber).padStart(5)}  ${String(r.endTick).padStart(7)}  ${r.shirtsSide.padStart(10)}  ` +
          `${side.padStart(10)}  ${String(raw).padStart(13)}  ${delta}`,
      );
    }
    console.log(`manually recomputed: ct=${ctTotal}, t=${tTotal}, total=${ctTotal + tTotal}`);
  }
  console.log('');
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
