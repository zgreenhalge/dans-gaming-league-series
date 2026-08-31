// TEMPORARY — validation for the #491 CT/T damage-split fix. For a given match, computes the
// CT/T split under both the old (m_iDamage delta) and new (m_flTotalRoundDamageDealt direct-read)
// logic, and compares each player's new-logic total (ct+t) against the independently-computed
// player_match_stats.damage already stored for that match (read via demoParser.ts's own separate
// final-tick m_iDamage path) as a soundness check. Delete before merging.
//
// Needs Cloudflare R2 + Supabase creds in env:
//   set -a; . ./.env.local; set +a
//   tsx scripts/verify-damage-split-fix.ts --match <id>

import { parseEvent, parseTicks } from '@laihoe/demoparser2';
import { gunzipMaybe } from '../src/lib/gzip';
import { parseArgs, die, loadDemoFromR2 } from './inspect-demo-shared';
import { readDemoPlayers, resolveRoster } from '../src/lib/parsers/rosterResolver';
import { getReplayInputs } from '../src/lib/replay/inputs';
import { getAdminClient } from '../src/lib/supabase-admin';
import { buildRoundSides, resolveSide } from '../src/lib/parsers/roundSides';

const NS = 'CCSPlayerController.CCSPlayerController_ActionTrackingServices';
const OLD_PROP = `${NS}.m_iDamage`;
const NEW_PROP = `${NS}.m_flTotalRoundDamageDealt`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.match !== 'string') die('Usage: tsx scripts/verify-damage-split-fix.ts --match <id>');
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
  console.log(`\n=== damage-split fix validation: match ${matchId} (${rounds.length} rounds) ===\n`);

  const endTicks = rounds.map((r) => r.endTick);
  const rows = parseTicks(demoBuffer, [OLD_PROP, NEW_PROP], endTicks) as Record<string, unknown>[];
  const byTickAndSteam = new Map<number, Map<string, Record<string, unknown>>>();
  for (const row of rows) {
    const tick = row.tick as number;
    const sid = String(row.steamid ?? '');
    if (!byTickAndSteam.has(tick)) byTickAndSteam.set(tick, new Map());
    byTickAndSteam.get(tick)!.set(sid, row);
  }

  const playerIds = [...steamToPlayer.values()].map((e) => e.player_id);
  const { data: statsRows, error } = await admin
    .from('player_match_stats')
    .select('player_id, damage')
    .eq('match_id', matchId)
    .in('player_id', playerIds);
  if (error) die(`player_match_stats query failed: ${error.message}`);
  const storedDamage = new Map<number, number>(
    (statsRows ?? [])
      .filter((r): r is { player_id: number; damage: number } => r.player_id !== null)
      .map((r) => [r.player_id, r.damage]),
  );

  console.log('player_id  faction  new_ct  new_t  new_total  old_ct  old_t  old_total  stored_damage  new_vs_stored_diff');
  for (const [steamId, entry] of steamToPlayer) {
    const prevOld = new Map<string, number>([[OLD_PROP, 0]]);
    let newCt = 0, newT = 0, oldCt = 0, oldT = 0;
    for (const r of rounds) {
      const row = byTickAndSteam.get(r.endTick)?.get(steamId);
      const side = resolveSide(r.shirtsSide, entry.faction);
      const newVal = Math.round((row?.[NEW_PROP] as number) ?? 0);
      const oldRaw = Math.round((row?.[OLD_PROP] as number) ?? 0);
      const oldDelta = oldRaw - (prevOld.get(OLD_PROP) ?? 0);
      prevOld.set(OLD_PROP, oldRaw);
      if (side === 'CT') { newCt += newVal; oldCt += oldDelta; } else { newT += newVal; oldT += oldDelta; }
    }
    const stored = storedDamage.get(entry.player_id) ?? null;
    const newTotal = newCt + newT;
    const diff = stored === null ? 'n/a' : String(newTotal - stored);
    console.log(
      `${String(entry.player_id).padStart(9)}  ${entry.faction.padStart(7)}  ${String(newCt).padStart(6)}  ` +
        `${String(newT).padStart(5)}  ${String(newTotal).padStart(9)}  ${String(oldCt).padStart(6)}  ` +
        `${String(oldT).padStart(5)}  ${String(oldCt + oldT).padStart(9)}  ${String(stored).padStart(13)}  ${diff}`,
    );
  }
  console.log('');
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
