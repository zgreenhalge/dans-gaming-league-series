// TEMPORARY — #491 residual damage-total gap investigation. Prints one player's per-round raw
// m_flTotalRoundDamageDealt value (what the fixed accumulators.ts credits) alongside m_iDamage's
// raw value and round-over-round delta (what the old logic credited), for every round in a match —
// narrows down which specific round(s) account for a mismatch between the new logic's total and
// player_match_stats.damage (both otherwise expected to agree, per verify-damage-split-fix.ts).
// Delete before merging.
//
// Needs Cloudflare R2 + Supabase creds in env:
//   set -a; . ./.env.local; set +a
//   tsx scripts/dump-player-round-damage.ts --match <id> --steamid <id>

import { parseEvent, parseTicks } from '@laihoe/demoparser2';
import { gunzipMaybe } from '../src/lib/gzip';
import { parseArgs, die, loadDemoFromR2 } from './inspect-demo-shared';
import { getReplayInputs } from '../src/lib/replay/inputs';
import { getAdminClient } from '../src/lib/supabase-admin';
import { buildRoundSides } from '../src/lib/parsers/roundSides';

const NS = 'CCSPlayerController.CCSPlayerController_ActionTrackingServices';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.match !== 'string' || typeof args.steamid !== 'string') {
    die('Usage: tsx scripts/dump-player-round-damage.ts --match <id> --steamid <id>');
  }
  const matchId = Number(args.match);
  const steamId = args.steamid as string;

  const admin = getAdminClient();
  const inputs = await getReplayInputs(admin, matchId);
  const rawBuf = await loadDemoFromR2(matchId);
  const demoBuffer = gunzipMaybe(rawBuf);

  const roundEndRows = parseEvent(demoBuffer, 'round_end', [], [
    'total_rounds_played', 'winner', 'is_warmup_period', 'reason',
  ]) as { tick: number; total_rounds_played: number; winner: string | null; reason: string | null; is_warmup_period: boolean | number }[];
  const rounds = buildRoundSides(roundEndRows, inputs.skinsSide, inputs.targetWinRounds, 0);

  const endTicks = rounds.map((r) => r.endTick);
  const rows = parseTicks(demoBuffer, [`${NS}.m_iDamage`, `${NS}.m_flTotalRoundDamageDealt`], endTicks) as Record<string, unknown>[];
  const byTick = new Map<number, Record<string, unknown>>();
  for (const row of rows) {
    if (String(row.steamid ?? '') === steamId) byTick.set(row.tick as number, row);
  }

  console.log(`\n=== per-round damage trajectory: match ${matchId}, steamid ${steamId} ===`);
  console.log('round  endTick  reason        m_iDamage  delta  m_flTotalRoundDamageDealt  running_new_total');
  let prevDamage = 0;
  let runningNew = 0;
  for (const r of rounds) {
    const row = byTick.get(r.endTick);
    const dmg = Math.round((row?.[`${NS}.m_iDamage`] as number) ?? NaN);
    const flt = Math.round((row?.[`${NS}.m_flTotalRoundDamageDealt`] as number) ?? NaN);
    const delta = Number.isNaN(dmg) ? NaN : dmg - prevDamage;
    if (!Number.isNaN(dmg)) prevDamage = dmg;
    if (!Number.isNaN(flt)) runningNew += flt;
    const endEvent = roundEndRows.find((e) => e.tick === r.endTick);
    console.log(
      `${String(r.roundNumber).padStart(5)}  ${String(r.endTick).padStart(7)}  ${(endEvent?.reason ?? '?').padEnd(12)}  ` +
        `${String(dmg).padStart(9)}  ${String(delta).padStart(5)}  ${String(flt).padStart(25)}  ${String(runningNew).padStart(17)}`,
    );
  }
  console.log('');
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
