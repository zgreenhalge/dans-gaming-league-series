// TEMPORARY — #491 root-cause audit. Two checks needed to scope a general fix for the
// round_end-tick sampling mistake found in accumulators.ts's SPLIT_PROPS:
//
// 1. Does `round_officially_ended` fire after EVERY round_end, including the match's last round
//    (where there's no "next round" to start)? If so, it's a uniform per-round "settle tick" —
//    every round's per-round-scoped netprops can be safely read there instead of at round_end.
// 2. Is UNSPLIT_PROPS's m_iUtilityDamage genuinely match-cumulative (never resets), or does it
//    reset per round the same way m_flTotalRoundDamageDealt does? accumulators.ts currently reads
//    it once at the final round's own end tick, assuming cumulative — that assumption was made
//    with the same "round_end tick is authoritative" mental model just proven wrong for
//    m_flTotalRoundDamageDealt, so it needs its own check rather than being carried over.
//
// Delete before merging.
//
// Needs Cloudflare R2 + Supabase creds in env:
//   set -a; . ./.env.local; set +a
//   tsx scripts/verify-round-reset-scope.ts --match <id> --steamid <id>

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
    die('Usage: tsx scripts/verify-round-reset-scope.ts --match <id> --steamid <id>');
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
  console.log(`\n=== round-reset-scope audit: match ${matchId} (${rounds.length} live rounds) ===\n`);

  console.log('--- check 1: does round_officially_ended fire after every round, including the last? ---');
  const officiallyEndedRows = parseEvent(demoBuffer, 'round_officially_ended', [], []) as { tick: number }[];
  const officiallyEndedTicks = [...new Set(officiallyEndedRows.map((r) => r.tick))].sort((a, b) => a - b);
  for (const r of rounds) {
    const next = officiallyEndedTicks.find((t) => t > r.endTick);
    const gap = next ? next - r.endTick : null;
    console.log(`  round ${r.roundNumber}: round_end=${r.endTick}  next round_officially_ended=${next ?? '(none found)'}  gap=${gap ?? 'n/a'}`);
  }

  console.log('\n--- check 2: is m_iUtilityDamage per-round-reset or match-cumulative? ---');
  const endTicks = rounds.map((r) => r.endTick);
  const rows = parseTicks(demoBuffer, [`${NS}.m_iUtilityDamage`], endTicks) as Record<string, unknown>[];
  const byTick = new Map<number, number>();
  for (const row of rows) {
    if (String(row.steamid ?? '') === steamId) byTick.set(row.tick as number, Math.round((row[`${NS}.m_iUtilityDamage`] as number) ?? NaN));
  }
  console.log('  round  endTick  m_iUtilityDamage_raw');
  for (const r of rounds) {
    console.log(`  ${String(r.roundNumber).padStart(5)}  ${String(r.endTick).padStart(7)}  ${String(byTick.get(r.endTick) ?? 'n/a').padStart(20)}`);
  }
  console.log('');
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
