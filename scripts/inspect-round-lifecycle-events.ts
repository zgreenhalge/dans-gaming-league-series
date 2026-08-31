// TEMPORARY — #491 residual damage-total gap investigation. CS2's round lifecycle has real dead
// time on both sides of round_end: a post-round delay (mp_round_restart_delay, ~5s) before the next
// round is created, then a pre-round freeze (buy time) before it goes live. round_end's own tick is
// therefore NOT the true reset boundary for a per-round-scoped netprop like
// m_flTotalRoundDamageDealt — sampling exactly at round_end may be too early (missing trailing
// action) or may straddle whatever tick the engine actually resets the counter at. This lists every
// round-lifecycle event (round_end, round_officially_ended, round_start, round_freeze_end) near a
// given round boundary with their ticks, and samples m_flTotalRoundDamageDealt at each of them for
// one player, to find where the true reset happens and which tick safely reads the completed round's
// full total. Delete before merging.
//
// Needs Cloudflare R2 + Supabase creds in env:
//   set -a; . ./.env.local; set +a
//   tsx scripts/inspect-round-lifecycle-events.ts --match <id> --round <n> [--steamid <id>]

import { parseEvent, parseTicks } from '@laihoe/demoparser2';
import { gunzipMaybe } from '../src/lib/gzip';
import { parseArgs, die, loadDemoFromR2 } from './inspect-demo-shared';
import { getReplayInputs } from '../src/lib/replay/inputs';
import { getAdminClient } from '../src/lib/supabase-admin';
import { buildRoundSides } from '../src/lib/parsers/roundSides';

const NS = 'CCSPlayerController.CCSPlayerController_ActionTrackingServices';
const CANDIDATE_EVENTS = [
  'round_end', 'round_officially_ended', 'round_start', 'round_freeze_end', 'round_prestart', 'round_poststart',
] as const;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.match !== 'string' || typeof args.round !== 'string') {
    die('Usage: tsx scripts/inspect-round-lifecycle-events.ts --match <id> --round <n> [--steamid <id>]');
  }
  const matchId = Number(args.match);
  const targetRound = Number(args.round);
  const targetSteamId = typeof args.steamid === 'string' ? args.steamid : null;

  const admin = getAdminClient();
  const inputs = await getReplayInputs(admin, matchId);
  const rawBuf = await loadDemoFromR2(matchId);
  const demoBuffer = gunzipMaybe(rawBuf);

  const roundEndRows = parseEvent(demoBuffer, 'round_end', [], [
    'total_rounds_played', 'winner', 'is_warmup_period', 'reason',
  ]) as { tick: number; total_rounds_played: number; winner: string | null; reason: string | null; is_warmup_period: boolean | number }[];
  const rounds = buildRoundSides(roundEndRows, inputs.skinsSide, inputs.targetWinRounds, 0);
  const round = rounds.find((r) => r.roundNumber === targetRound);
  if (!round) die(`round ${targetRound} not found (live rounds: ${rounds.length})`);
  const nextRound = rounds.find((r) => r.roundNumber === targetRound + 1);

  console.log(`\n=== round lifecycle inspection: match ${matchId}, round ${targetRound} ===`);
  console.log(`round ${targetRound} round_end tick=${round.endTick}`);

  const windowStart = round.endTick - 50;
  const windowEnd = nextRound ? nextRound.endTick : round.endTick + 3000;

  const allTicks: { event: string; tick: number }[] = [];
  for (const ev of CANDIDATE_EVENTS) {
    try {
      const rows = parseEvent(demoBuffer, ev, [], []) as { tick: number }[];
      const inWindow = rows.filter((r) => r.tick >= windowStart && r.tick <= windowEnd);
      console.log(`\n${ev}: ${inWindow.length} in window [${windowStart}, ${windowEnd}]`);
      for (const r of inWindow) {
        console.log(`  tick=${r.tick} (${r.tick - round.endTick >= 0 ? '+' : ''}${r.tick - round.endTick} from round_end)`);
        allTicks.push({ event: ev, tick: r.tick });
      }
    } catch (e) {
      console.log(`\n${ev}: not available in this demo (${e instanceof Error ? e.message : e})`);
    }
  }

  if (targetSteamId) {
    allTicks.sort((a, b) => a.tick - b.tick);
    const uniqueTicks = [...new Set(allTicks.map((t) => t.tick))];
    if (uniqueTicks.length > 0) {
      const rows = parseTicks(demoBuffer, [`${NS}.m_flTotalRoundDamageDealt`], uniqueTicks) as Record<string, unknown>[];
      console.log(`\nm_flTotalRoundDamageDealt for steamid ${targetSteamId} at each lifecycle tick:`);
      for (const t of uniqueTicks) {
        const row = rows.find((r) => r.tick === t && String(r.steamid ?? '') === targetSteamId);
        const events = allTicks.filter((e) => e.tick === t).map((e) => e.event).join('+');
        console.log(`  tick=${t} (${events}): ${row ? row[`${NS}.m_flTotalRoundDamageDealt`] : '(no row)'}`);
      }
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
