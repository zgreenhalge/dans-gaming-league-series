import { parseEvent, parseTicks } from '@laihoe/demoparser2';
import type { RosterEntry } from './demoParser';
import type { SabFields, DemoSabremetricStat, ParsedDemoSabremetricsResult } from './types';
import { readDemoPlayers, resolveRoster } from './parsers/rosterResolver';
import { buildMatchContext, findMatchStartTick, type PlayerDeathRow, type PlayerHurtRow } from './parsers/matchContext';
import type { RoundEndRow } from './parsers/roundSides';
import { inferSkinsStartingSide, resolveEffectiveSide } from './parsers/sideInference';
import { collectAccumulators } from './parsers/accumulators';
import { collectEntry } from './parsers/entry';
import { collectKast } from './parsers/kast';
import { collectMultikill } from './parsers/multikill';
import { collectClutch } from './parsers/clutch';
import { collectUtility, type PlayerBlindRow, type WeaponFireRow } from './parsers/utility';
import { collectObjectives, type BombEventRow } from './parsers/objectives';
import { collectTrades } from './parsers/trades';
import { collectHeGrenades } from './parsers/heGrenade';
import { collectAccuracy } from './parsers/accuracy';
import {
  collectCounterStrafe, neededCounterStrafeTicks, type PlayerTickRow,
} from './parsers/counterStrafe';

const ZERO: SabFields = {
  kills_ct: 0, kills_t: 0,
  deaths_ct: 0, deaths_t: 0,
  assists_ct: 0, assists_t: 0,
  damage_ct: 0, damage_t: 0,
  headshot_kills: 0, headshot_kills_ct: 0, headshot_kills_t: 0,
  opening_kills: 0, opening_deaths: 0,
  kast_rounds: 0,
  clutch_1v1_attempts: 0, clutch_1v1_wins: 0,
  clutch_1v2_attempts: 0, clutch_1v2_wins: 0,
  flash_assists: 0,
  flashes_leading_to_kill: 0,
  utility_damage: 0,
  blind_duration_dealt: 0,
  enemies_flashed: 0,
  flashes_thrown: 0,
  teamflash_duration: 0,
  plants: 0,
  defuses: 0,
  two_k_rounds: 0,
  trade_kill_opportunities: 0,
  trade_kill_attempts: 0,
  trade_kill_successes: 0,
  traded_death_opportunities: 0,
  traded_death_attempts: 0,
  traded_death_successes: 0,
  he_thrown: 0,
  he_damage: 0,
  blind_duration_max_sum: 0,
  effective_flashes: 0,
  shots_fired: 0,
  shots_hit: 0,
  headshot_hits: 0,
  counter_strafe_shots: 0,
  counter_strafe_good_shots: 0,
};

export function parseDemoSabremetrics(
  demoBuffer: Buffer,
  roster: RosterEntry[],
  skinsSide: 'CT' | 'T' | null,
  targetWinRounds: number,
): ParsedDemoSabremetricsResult {
  const warnings: string[] = [];

  // 1. Roster resolution
  const demoPlayers = readDemoPlayers(demoBuffer);
  const steamToPlayer = resolveRoster(demoPlayers, roster, warnings);
  const steamIds = [...steamToPlayer.keys()];

  // 2. Parse events (single pass each)
  const roundEndEvents = parseEvent(
    demoBuffer, 'round_end', [], ['total_rounds_played', 'winner', 'is_warmup_period'],
  ) as RoundEndRow[];

  const deathEvents = parseEvent(
    demoBuffer, 'player_death', [],
    ['total_rounds_played', 'is_warmup_period', 'headshot', 'assister_steamid'],
  ) as PlayerDeathRow[];

  const blindEvents = parseEvent(
    demoBuffer, 'player_blind', [], ['total_rounds_played', 'blind_duration'],
  ) as PlayerBlindRow[];

  const fireEvents = parseEvent(
    demoBuffer, 'weapon_fire', [], ['total_rounds_played'],
  ) as WeaponFireRow[];

  const plantEvents = parseEvent(
    demoBuffer, 'bomb_planted', [], ['total_rounds_played'],
  ) as BombEventRow[];

  const defuseEvents = parseEvent(
    demoBuffer, 'bomb_defused', [], ['total_rounds_played'],
  ) as BombEventRow[];

  const hurtEvents = parseEvent(
    demoBuffer, 'player_hurt', [], ['total_rounds_played', 'weapon', 'dmg_health', 'hitgroup'],
  ) as PlayerHurtRow[];

  // 3. Build match context — resolve the starting side the same way parseDemoFile does
  // (stored wins; otherwise infer from the demo) so sabremetrics and the score agree.
  const matchStartTick = findMatchStartTick(demoBuffer);
  const sabLiveRounds = roundEndEvents.filter(
    (e) => !e.is_warmup_period && e.winner !== null && e.total_rounds_played > 0 && e.tick >= matchStartTick,
  );
  const inferredSide =
    sabLiveRounds.length > 0
      ? inferSkinsStartingSide(demoBuffer, sabLiveRounds[0].tick, steamToPlayer)
      : null;
  const { side: effectiveSide } = resolveEffectiveSide(skinsSide, inferredSide);

  const context = buildMatchContext(
    demoBuffer, roundEndEvents, deathEvents,
    steamToPlayer, effectiveSide, targetWinRounds,
  );
  warnings.push(...context.warnings);

  if (context.rounds.length === 0) {
    return { sabremetrics: [], warnings: [...warnings, 'No live rounds found in demo.'] };
  }

  // 4. Accumulator-based stats (split basic + headshots + unsplit utility/flashed)
  const accStats = collectAccumulators(demoBuffer, context, steamIds);

  // 5. Event-based collectors
  const entryStats = collectEntry(deathEvents, context, steamIds);
  const kastStats = collectKast(deathEvents, context, steamIds);
  const multikillStats = collectMultikill(deathEvents, context, steamIds);
  const clutchStats = collectClutch(deathEvents, context, steamIds);
  const utilityStats = collectUtility(blindEvents, deathEvents, fireEvents, context, steamIds);
  const objectiveStats = collectObjectives(plantEvents, defuseEvents, context, steamIds);
  const tradeStats = collectTrades(deathEvents, hurtEvents, context, steamIds);
  const heStats = collectHeGrenades(fireEvents, hurtEvents, context, steamIds);
  const accuracyStats = collectAccuracy(fireEvents, hurtEvents, context, steamIds);

  // Counter-strafe needs per-tick position/duck-state reads (not a plain event stream), so it
  // fetches its own tick list — same shape as accumulators.ts's round-end reads, but keyed to
  // rifle weapon_fire ticks instead.
  const csTicks = neededCounterStrafeTicks(fireEvents, context.liveRounds);
  let csTickRows: PlayerTickRow[] = [];
  if (csTicks.length > 0) {
    const rawTickRows = parseTicks(
      demoBuffer,
      [
        'CCSPlayerPawn.CCSPlayer_MovementServices.m_bDucked',
        'CCSPlayerPawn.CCSPlayer_MovementServices.m_flMaxspeed',
        'X', 'Y',
      ],
      csTicks,
    ) as Record<string, unknown>[];
    csTickRows = rawTickRows.map((r) => ({
      tick: Number(r.tick),
      steamid: String(r.steamid ?? ''),
      ducked: Boolean(r['CCSPlayerPawn.CCSPlayer_MovementServices.m_bDucked']),
      maxSpeed: Number(r['CCSPlayerPawn.CCSPlayer_MovementServices.m_flMaxspeed'] ?? 0),
      x: Number(r.X ?? 0),
      y: Number(r.Y ?? 0),
    }));
  }
  const counterStrafeStats = collectCounterStrafe(fireEvents, csTickRows, context, steamIds);

  // 6. Merge with zero defaults
  const sabremetrics: DemoSabremetricStat[] = steamIds.map((steamId) => ({
    player_id: steamToPlayer.get(steamId)!.player_id,
    sabremetrics: {
      ...ZERO,
      ...accStats.get(steamId),
      ...entryStats.get(steamId),
      ...kastStats.get(steamId),
      ...multikillStats.get(steamId),
      ...clutchStats.get(steamId),
      ...utilityStats.get(steamId),
      ...objectiveStats.get(steamId),
      ...tradeStats.get(steamId),
      ...heStats.get(steamId),
      ...accuracyStats.get(steamId),
      ...counterStrafeStats.get(steamId),
    },
  }));

  // Deduplicate warnings
  const uniqueWarnings = [...new Set(warnings)];

  return { sabremetrics, warnings: uniqueWarnings };
}
