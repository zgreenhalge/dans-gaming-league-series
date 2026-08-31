// TEMPORARY — #491 residual damage-total gap investigation. collectMatchDamageEvents()
// (weaponStats.ts) drops any player_hurt row whose victim isn't in the roster steamSet before
// clamping runs, so that attacker's damage to that victim never enters match_damage_events at all —
// even though the engine's own accumulator (m_flTotalRoundDamageDealt) counts it regardless of who
// the victim was. This runs the real parseDemoSabremetrics() pipeline for a match (picking up the
// m_flTotalRoundDamageDealt fix), compares each player's accumulator total (damage_ct+damage_t)
// against their matchDamageEvents-derived total, and separately re-parses raw player_hurt events to
// measure how much damage a roster-scoped victim filter drops per attacker — so the size of that
// effect can be checked directly against the accumulator/match_damage_events gap. Delete before
// merging.
//
// Needs Cloudflare R2 + Supabase creds in env:
//   set -a; . ./.env.local; set +a
//   tsx scripts/inspect-dropped-damage.ts --match <id>

import { parseEvent } from '@laihoe/demoparser2';
import { gunzipMaybe } from '../src/lib/gzip';
import { parseArgs, die, loadDemoFromR2 } from './inspect-demo-shared';
import { readDemoPlayers, resolveRoster } from '../src/lib/parsers/rosterResolver';
import { findMatchStartTick, type PlayerHurtRow } from '../src/lib/parsers/matchContext';
import { getReplayInputs } from '../src/lib/replay/inputs';
import { getAdminClient } from '../src/lib/supabase-admin';
import { parseDemoSabremetrics } from '../src/lib/demoOrchestrator';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.match !== 'string') die('Usage: tsx scripts/inspect-dropped-damage.ts --match <id>');
  const matchId = Number(args.match);

  const admin = getAdminClient();
  const inputs = await getReplayInputs(admin, matchId);

  const rawBuf = await loadDemoFromR2(matchId);
  const demoBuffer = gunzipMaybe(rawBuf);

  console.log(`\n=== dropped-damage inspection: match ${matchId} ===`);

  const result = parseDemoSabremetrics(demoBuffer, inputs.roster, inputs.skinsSide, inputs.targetWinRounds);
  if (result.warnings.length > 0) console.log('parse warnings:', result.warnings);

  const accTotalByPlayer = new Map<number, number>();
  for (const s of result.sabremetrics) {
    accTotalByPlayer.set(s.player_id, s.sabremetrics.damage_ct + s.sabremetrics.damage_t);
  }

  const mdeTotalByPlayer = new Map<number, number>();
  const mdeSelfByPlayer = new Map<number, number>();
  for (const e of result.matchDamageEvents) {
    if (e.attacker_player_id === null) continue;
    mdeTotalByPlayer.set(e.attacker_player_id, (mdeTotalByPlayer.get(e.attacker_player_id) ?? 0) + e.damage);
    if (e.attacker_player_id === e.victim_player_id) {
      mdeSelfByPlayer.set(e.attacker_player_id, (mdeSelfByPlayer.get(e.attacker_player_id) ?? 0) + e.damage);
    }
  }

  console.log('\nplayer_id  accumulator_total  match_damage_events_total  self_damage  accumulator_minus_mde');
  for (const [playerId, accTotal] of accTotalByPlayer) {
    const mdeTotal = mdeTotalByPlayer.get(playerId) ?? 0;
    const self = mdeSelfByPlayer.get(playerId) ?? 0;
    console.log(
      `${String(playerId).padStart(9)}  ${String(accTotal).padStart(17)}  ${String(mdeTotal).padStart(26)}  ` +
        `${String(self).padStart(11)}  ${accTotal - mdeTotal}`,
    );
  }

  // Independent raw pass: which player_hurt hits does collectMatchDamageEvents() drop for having a
  // victim outside the roster steamSet, and how much raw damage do they carry per attacker?
  const demoPlayers = readDemoPlayers(demoBuffer);
  const warnings: string[] = [];
  const steamToPlayer = resolveRoster(demoPlayers, inputs.roster, warnings);
  const steamSet = new Set(steamToPlayer.keys());

  const hurtEvents = parseEvent(
    demoBuffer, 'player_hurt', [], ['total_rounds_played', 'weapon', 'dmg_health', 'hitgroup'],
  ) as PlayerHurtRow[];
  const matchStartTick = findMatchStartTick(demoBuffer);

  let droppedCount = 0;
  let droppedDamage = 0;
  const droppedByAttacker = new Map<string, { count: number; damage: number }>();
  const unknownVictims = new Set<string>();

  for (const h of hurtEvents) {
    if (h.tick < matchStartTick) continue;
    const victim = h.user_steamid ?? '';
    if (!victim || !steamSet.has(victim)) {
      droppedCount++;
      droppedDamage += h.dmg_health;
      unknownVictims.add(victim || '(empty)');
      const key = h.attacker_steamid && steamSet.has(h.attacker_steamid) ? h.attacker_steamid : '(unresolvable attacker)';
      const entry = droppedByAttacker.get(key) ?? { count: 0, damage: 0 };
      entry.count++;
      entry.damage += h.dmg_health;
      droppedByAttacker.set(key, entry);
    }
  }

  console.log(`\ndropped hits (victim not in roster steamSet, tick >= matchStartTick): ${droppedCount}, raw damage sum: ${droppedDamage}`);
  console.log(`distinct unresolvable victim steamids: ${[...unknownVictims].join(', ') || '(none)'}`);
  console.log('dropped damage by attacker (raw, unclamped — an upper bound, since clamping would reduce this):');
  for (const [attacker, entry] of droppedByAttacker) {
    const entryLabel = steamToPlayer.get(attacker);
    console.log(
      `  ${attacker}${entryLabel ? ` (player_id ${entryLabel.player_id}, ${entryLabel.faction})` : ''}: ` +
        `${entry.count} hit(s), ${entry.damage} raw damage`,
    );
  }
  console.log('');
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
