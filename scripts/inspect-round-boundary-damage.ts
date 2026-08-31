// TEMPORARY — #491 residual damage-total gap investigation. Tests the hypothesis that a round
// ending by bomb detonation can leave players alive at the round_end tick who then die from the
// explosion itself a few ticks later — meaning their bomb damage lands in the gap between round_end
// firing and the per-round accumulator (m_flTotalRoundDamageDealt) resetting for the next round,
// so a tick-of-round_end sample misses it entirely (unlike m_iDamage, which never resets and picks
// it up whenever next sampled). Dumps round_end/bomb events and every player_hurt/player_death near
// a given round boundary, plus both damage netprops sampled at that round's end tick and the next
// round's end tick, for one player. Delete before merging.
//
// Needs Cloudflare R2 + Supabase creds in env:
//   set -a; . ./.env.local; set +a
//   tsx scripts/inspect-round-boundary-damage.ts --match <id> --round <n> [--steamid <id>]

import { parseEvent, parseTicks } from '@laihoe/demoparser2';
import { gunzipMaybe } from '../src/lib/gzip';
import { parseArgs, die, loadDemoFromR2 } from './inspect-demo-shared';
import { readDemoPlayers, resolveRoster } from '../src/lib/parsers/rosterResolver';
import { getReplayInputs } from '../src/lib/replay/inputs';
import { getAdminClient } from '../src/lib/supabase-admin';
import { buildRoundSides } from '../src/lib/parsers/roundSides';

const NS = 'CCSPlayerController.CCSPlayerController_ActionTrackingServices';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.match !== 'string' || typeof args.round !== 'string') {
    die('Usage: tsx scripts/inspect-round-boundary-damage.ts --match <id> --round <n> [--steamid <id>]');
  }
  const matchId = Number(args.match);
  const targetRound = Number(args.round);
  const targetSteamId = typeof args.steamid === 'string' ? args.steamid : null;

  const admin = getAdminClient();
  const inputs = await getReplayInputs(admin, matchId);
  const rawBuf = await loadDemoFromR2(matchId);
  const demoBuffer = gunzipMaybe(rawBuf);

  const demoPlayers = readDemoPlayers(demoBuffer);
  const warnings: string[] = [];
  const steamToPlayer = resolveRoster(demoPlayers, inputs.roster, warnings);

  const roundEndRows = parseEvent(demoBuffer, 'round_end', [], [
    'total_rounds_played', 'winner', 'is_warmup_period', 'reason',
  ]) as { tick: number; total_rounds_played: number; winner: string | null; reason: string | null; is_warmup_period: boolean | number }[];
  const rounds = buildRoundSides(roundEndRows, inputs.skinsSide, inputs.targetWinRounds, 0);
  const round = rounds.find((r) => r.roundNumber === targetRound);
  const nextRound = rounds.find((r) => r.roundNumber === targetRound + 1);
  if (!round) die(`round ${targetRound} not found (live rounds: ${rounds.length})`);

  console.log(`\n=== round boundary inspection: match ${matchId}, round ${targetRound} ===`);
  console.log(`round ${targetRound} endTick=${round.endTick}, shirtsSide=${round.shirtsSide}`);
  if (nextRound) console.log(`round ${targetRound + 1} endTick=${nextRound.endTick}, shirtsSide=${nextRound.shirtsSide}`);

  const windowStart = round.endTick - 200;
  const windowEnd = nextRound ? nextRound.endTick : round.endTick + 2000;

  for (const ev of ['bomb_planted', 'bomb_exploded', 'bomb_defused'] as const) {
    try {
      const rows = parseEvent(demoBuffer, ev, [], ['total_rounds_played']) as { tick: number; total_rounds_played: number }[];
      const inWindow = rows.filter((r) => r.tick >= windowStart && r.tick <= windowEnd);
      console.log(`\n${ev}: ${inWindow.length} in window`);
      for (const r of inWindow) console.log(`  tick=${r.tick} total_rounds_played=${r.total_rounds_played}`);
    } catch (e) {
      console.log(`\n${ev}: threw (${e instanceof Error ? e.message : e})`);
    }
  }

  const deathRows = parseEvent(demoBuffer, 'player_death', [], ['total_rounds_played']) as {
    tick: number; total_rounds_played: number; user_steamid: string | bigint;
  }[];
  console.log(`\nplayer_death events in window [${windowStart}, ${windowEnd}]:`);
  for (const d of deathRows.filter((r) => r.tick >= windowStart && r.tick <= windowEnd)) {
    const sid = String(d.user_steamid ?? '');
    const label = steamToPlayer.get(sid);
    console.log(
      `  tick=${d.tick} (+${d.tick - round.endTick} from round_end) total_rounds_played=${d.total_rounds_played} ` +
        `victim=${sid}${label ? ` (player_id ${label.player_id})` : ''}`,
    );
  }

  const hurtRows = parseEvent(demoBuffer, 'player_hurt', [], [
    'total_rounds_played', 'weapon', 'dmg_health', 'hitgroup',
  ]) as { tick: number; total_rounds_played: number; weapon: string; dmg_health: number; hitgroup: string; user_steamid: string | bigint; attacker_steamid: string | bigint | null }[];
  console.log(`\nplayer_hurt events in window [${windowStart}, ${windowEnd}]:`);
  for (const h of hurtRows.filter((r) => r.tick >= windowStart && r.tick <= windowEnd)) {
    const victim = String(h.user_steamid ?? '');
    const attacker = h.attacker_steamid ? String(h.attacker_steamid) : null;
    const vLabel = steamToPlayer.get(victim);
    const aLabel = attacker ? steamToPlayer.get(attacker) : null;
    console.log(
      `  tick=${h.tick} (+${h.tick - round.endTick} from round_end) total_rounds_played=${h.total_rounds_played} ` +
        `weapon=${h.weapon} dmg_health=${h.dmg_health} attacker=${attacker ?? '(none)'}${aLabel ? ` (player_id ${aLabel.player_id})` : ''} ` +
        `victim=${victim}${vLabel ? ` (player_id ${vLabel.player_id})` : ''}`,
    );
  }

  if (targetSteamId) {
    const ticks = [round.endTick, ...(nextRound ? [nextRound.endTick] : [])];
    const props = [`${NS}.m_iDamage`, `${NS}.m_flTotalRoundDamageDealt`];
    const rows = parseTicks(demoBuffer, props, ticks) as Record<string, unknown>[];
    console.log(`\nnetprop samples for steamid ${targetSteamId}:`);
    for (const r of rows) {
      if (String(r.steamid ?? '') !== targetSteamId) continue;
      console.log(`  tick=${r.tick}: m_iDamage=${r[props[0]]}  m_flTotalRoundDamageDealt=${r[props[1]]}`);
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
