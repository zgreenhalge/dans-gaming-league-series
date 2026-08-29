import { parseEvent, parseTicks } from '@laihoe/demoparser2';
import type { RosterEntry } from './demoParser';
import type {
  SabFields, DemoSabremetricStat, DemoWeaponStat, DemoMatchKill, DemoMatchRound,
  DemoMatchUtilityThrow, DemoMatchRoundEconomy, ParsedDemoSabremetricsResult,
} from './types';
import { readDemoPlayers, resolveRoster } from './parsers/rosterResolver';
import { buildMatchContext, collectMidairAttackers, dedupeDeathEvents, findMatchStartTick, type PlayerDeathRow, type PlayerHurtRow } from './parsers/matchContext';
import type { RoundEndRow } from './parsers/roundSides';
import { inferSkinsStartingSide, resolveEffectiveSide } from './parsers/sideInference';
import { collectAccumulators } from './parsers/accumulators';
import { collectKast } from './parsers/kast';
import {
  collectUtility, collectMatchUtilityThrows, type PlayerBlindRow, type WeaponFireRow,
} from './parsers/utility';
import { collectObjectives, type BombEventRow } from './parsers/objectives';
import { collectTrades, computeTradeOpportunities, neededTradeTicks } from './parsers/trades';
import { collectHeGrenades } from './parsers/heGrenade';
import { collectAccuracy } from './parsers/accuracy';
import {
  collectCounterStrafe, neededCounterStrafeTicks, type PlayerTickRow,
} from './parsers/counterStrafe';
import { collectSprayAccuracy } from './parsers/sprayAccuracy';
import {
  collectSmokes, neededSmokeTicks, type SmokeEventRow, type PlayerPositionRow,
} from './parsers/smokes';
import {
  collectUnusedUtility, neededInventoryTicks, type PlayerInventoryRow,
} from './parsers/unusedUtility';
import {
  collectRoundsDropped, neededReloadTicks, type WeaponReloadRow, type PlayerReloadStateRow,
} from './parsers/reload';
import {
  classifyRoundEconomy, collectMatchRoundEconomy, neededEconomyTicks,
  type RoundFreezeEndRow, type PlayerEquipmentRow,
} from './parsers/economy';
import { collectWeaponClassStats, collectEconomyStats, collectMatchKills } from './parsers/weaponStats';
import { WEAPON_CATEGORY } from './parsers/weaponClasses';

const ZERO: SabFields = {
  damage_ct: 0, damage_t: 0,
  kast_rounds: 0,
  utility_damage: 0,
  flashes_thrown: 0,
  plants: 0,
  defuses: 0,
  trade_kill_opportunities: 0,
  trade_kill_attempts: 0,
  trade_kill_successes: 0,
  traded_death_opportunities: 0,
  traded_death_attempts: 0,
  traded_death_successes: 0,
  he_thrown: 0,
  he_damage: 0,
  shots_hit_no_awp: 0,
  headshot_hits_no_awp: 0,
  counter_strafe_shots: 0,
  counter_strafe_good_shots: 0,
  spray_shots_fired: 0,
  spray_shots_hit: 0,
  smokes_blocking_push: 0,
  ct_smokes_thrown: 0,
  unused_util_value_on_death_total: 0,
  rounds_dropped_on_reload_total: 0,
  reloads_total: 0,
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
    demoBuffer, 'round_end', [], ['total_rounds_played', 'winner', 'is_warmup_period', 'reason'],
  ) as RoundEndRow[];

  const deathEvents = parseEvent(
    demoBuffer, 'player_death', [],
    [
      'total_rounds_played', 'is_warmup_period', 'headshot', 'assister_steamid', 'weapon',
      'noscope', 'penetrated', 'attackerblind',
    ],
  ) as PlayerDeathRow[];
  const midairByTickSteam = collectMidairAttackers(demoBuffer, deathEvents);

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

  const smokeDetonateEvents = parseEvent(
    demoBuffer, 'smokegrenade_detonate', [], ['total_rounds_played'],
  ) as SmokeEventRow[];

  const smokeExpireEvents = parseEvent(
    demoBuffer, 'smokegrenade_expired', [], ['total_rounds_played'],
  ) as SmokeEventRow[];

  const freezeEndEvents = parseEvent(
    demoBuffer, 'round_freeze_end', [], ['total_rounds_played'],
  ) as RoundFreezeEndRow[];

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

  if (context.rounds.length === 0) {
    warnings.push(...context.warnings);
    return {
      sabremetrics: [], weaponStats: [], matchKills: [], matchRounds: [],
      matchUtilityThrows: [], matchRoundEconomy: [],
      warnings: [...warnings, 'No live rounds found in demo.'],
    };
  }

  // Deduped once here, not per collector — every event-based collector below reads this, not the
  // raw `deathEvents` (buildMatchContext's own buildRoundDeaths() already ran on the raw stream;
  // see dedupeDeathEvents()'s own doc comment for why that's fine).
  const liveDeathEvents = dedupeDeathEvents(deathEvents, context);
  warnings.push(...context.warnings);

  // 4. Accumulator-based stats (split basic + headshots + unsplit utility/flashed)
  const accStats = collectAccumulators(demoBuffer, context, steamIds);

  // Trade opportunities need each teammate's position at the moment of a death, to gate out
  // "alive and on the same side, but across the map" — fetched early and reduced to a single
  // opportunities result since both collectKast's "Traded" qualifier and collectTrades() below
  // need to agree on exactly who had a real trade opportunity.
  const tradeTicks = neededTradeTicks(liveDeathEvents, context);
  let tradePositionRows: PlayerPositionRow[] = [];
  if (tradeTicks.length > 0) {
    const rawTradeRows = parseTicks(demoBuffer, ['X', 'Y'], tradeTicks) as Record<string, unknown>[];
    tradePositionRows = rawTradeRows.map((r) => ({
      tick: Number(r.tick),
      steamid: String(r.steamid ?? ''),
      x: Number(r.X ?? 0),
      y: Number(r.Y ?? 0),
    }));
  }
  const tradeOpportunities = computeTradeOpportunities(liveDeathEvents, tradePositionRows, context, steamIds);

  // 5. Event-based collectors
  const kastStats = collectKast(liveDeathEvents, context, steamIds, tradeOpportunities);
  const utilityStats = collectUtility(fireEvents, context, steamIds);
  const objectiveStats = collectObjectives(plantEvents, defuseEvents, context, steamIds);
  const heStats = collectHeGrenades(fireEvents, hurtEvents, context, steamIds);
  const accuracyStats = collectAccuracy(hurtEvents, context, steamIds);

  // Counter-strafe needs per-tick position/duck-state reads (not a plain event stream), so it
  // fetches its own tick list — same shape as accumulators.ts's round-end reads, but keyed to
  // rifle weapon_fire ticks instead.
  const csTicks = neededCounterStrafeTicks(fireEvents, context);
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
  const sprayStats = collectSprayAccuracy(fireEvents, hurtEvents, context, steamIds);

  // Smokes need every player's position sampled across each smoke's life, not a plain event
  // stream — same per-tick-fetch shape as counter-strafe above.
  const smokeTicks = neededSmokeTicks(smokeDetonateEvents, smokeExpireEvents, context);
  let smokePositionRows: PlayerPositionRow[] = [];
  if (smokeTicks.length > 0) {
    const rawSmokeRows = parseTicks(demoBuffer, ['X', 'Y'], smokeTicks) as Record<string, unknown>[];
    smokePositionRows = rawSmokeRows.map((r) => ({
      tick: Number(r.tick),
      steamid: String(r.steamid ?? ''),
      x: Number(r.X ?? 0),
      y: Number(r.Y ?? 0),
    }));
  }
  const smokeStats = collectSmokes(
    smokeDetonateEvents, smokeExpireEvents, smokePositionRows, context, steamIds,
  );

  const tradeStats = collectTrades(liveDeathEvents, hurtEvents, tradeOpportunities, context, steamIds);

  // Unused Utility on Death reads demoparser2's "inventory" tick field (see unusedUtility.ts) —
  // wrapped so a future parser change to that field zeroes out just this stat instead of failing
  // every collector.
  const inventoryTicks = neededInventoryTicks(liveDeathEvents, context);
  let inventoryRows: PlayerInventoryRow[] = [];
  if (inventoryTicks.length > 0) {
    try {
      const rawInventoryRows = parseTicks(demoBuffer, ['inventory'], inventoryTicks) as Record<string, unknown>[];
      inventoryRows = rawInventoryRows.map((r) => ({
        tick: Number(r.tick),
        steamid: String(r.steamid ?? ''),
        inventory: Array.isArray(r.inventory) ? (r.inventory as string[]) : [],
      }));
    } catch (err) {
      warnings.push(
        `Unused Utility on Death not computed: demoparser2's "inventory" tick field failed (${(err as Error).message}).`,
      );
    }
  }
  const unusedUtilStats = collectUnusedUtility(liveDeathEvents, inventoryRows, context, steamIds);

  // Rounds dropped on reload (#212): weapon_reload is a discrete game event (confirmed against a
  // real DGLS demo, unlike most CS2 actions), so this reads Weapon.m_iClip1/Weapon.m_bInReload at
  // each event's own tick instead of periodic sampling — the pre-reload clip count is frozen for
  // the whole reload window (can't fire mid-reload), so the event tick itself always lands inside
  // it. Wrapped defensively like unusedUtility.ts's "inventory" field so a future parser/game
  // change degrades this stat to zero instead of failing ingestion.
  const reloadEvents = parseEvent(
    demoBuffer, 'weapon_reload', [], ['total_rounds_played'],
  ) as WeaponReloadRow[];
  const reloadTicks = neededReloadTicks(reloadEvents, context);
  let reloadStateRows: PlayerReloadStateRow[] = [];
  if (reloadTicks.length > 0) {
    try {
      const rawReloadRows = parseTicks(
        demoBuffer, ['Weapon.m_iClip1', 'Weapon.m_bInReload'], reloadTicks,
      ) as Record<string, unknown>[];
      reloadStateRows = rawReloadRows.map((r) => ({
        tick: Number(r.tick),
        steamid: String(r.steamid ?? ''),
        inReload: Boolean(r['Weapon.m_bInReload']),
        clip1: Number(r['Weapon.m_iClip1'] ?? 0),
      }));
    } catch (err) {
      warnings.push(
        `Rounds Dropped on Reload not computed: demoparser2's "Weapon.m_iClip1"/"Weapon.m_bInReload" tick fields failed (${(err as Error).message}).`,
      );
    }
  }
  const reloadStats = collectRoundsDropped(reloadEvents, reloadStateRows, context, steamIds);

  // Round economy (#279): classifies each player's eco/force-buy/full-buy tier per round from
  // CCSPlayerPawn.m_unFreezetimeEndEquipmentValue at each round's freeze-time-end, sampled once
  // per round (not per shot) — same single-anchor-read shape as sideInference.ts. Wrapped
  // defensively like the reload/inventory tick reads above.
  const economyTicks = neededEconomyTicks(freezeEndEvents, context);
  let equipmentRows: PlayerEquipmentRow[] = [];
  if (economyTicks.length > 0) {
    try {
      const rawEquipmentRows = parseTicks(
        demoBuffer, ['CCSPlayerPawn.m_unFreezetimeEndEquipmentValue'], economyTicks,
      ) as Record<string, unknown>[];
      equipmentRows = rawEquipmentRows.map((r) => ({
        tick: Number(r.tick),
        steamid: String(r.steamid ?? ''),
        equipmentValue: Number(r['CCSPlayerPawn.m_unFreezetimeEndEquipmentValue'] ?? 0),
      }));
    } catch (err) {
      warnings.push(
        `Weapon-type economy stats not computed: demoparser2's "CCSPlayerPawn.m_unFreezetimeEndEquipmentValue" tick field failed (${(err as Error).message}).`,
      );
    }
  }
  const roundEconomy = classifyRoundEconomy(freezeEndEvents, equipmentRows, context, steamIds);

  // Per-weapon-category and per-round-economy shot/accuracy/damage/rounds breakdowns (#279).
  const weaponClassStats = collectWeaponClassStats(fireEvents, hurtEvents, context, steamIds);
  const economyStats = collectEconomyStats(fireEvents, hurtEvents, roundEconomy, context, steamIds);

  // Per-kill and per-round fact rows (#452/#453) — flat event rows, not per-player aggregates.
  const killFacts = collectMatchKills(liveDeathEvents, context, steamIds, midairByTickSteam);
  const playerIdOf = (steamId: string | null): number | null =>
    steamId ? (steamToPlayer.get(steamId)?.player_id ?? null) : null;
  const matchKills: DemoMatchKill[] = killFacts.map((k) => ({
    round_number: k.round_number,
    attacker_player_id: playerIdOf(k.attacker_steamid),
    victim_player_id: playerIdOf(k.victim_steamid)!,
    assister_player_id: playerIdOf(k.assister_steamid),
    weapon: k.weapon,
    headshot: k.headshot,
    noscope: k.noscope,
    wallbang: k.wallbang,
    blind_kill: k.blind_kill,
    midair: k.midair,
    is_teamkill: k.is_teamkill,
    tick: k.tick,
  }));
  const matchRounds: DemoMatchRound[] = context.rounds.map((r) => ({
    round_number: r.roundNumber,
    winner_side: r.winnerSide!, // buildRoundSides only returns rounds with a known winner
    shirts_side: r.shirtsSide,
    win_reason: r.winReason,
  }));

  const utilityThrowFacts = collectMatchUtilityThrows(blindEvents, context, steamIds);
  const matchUtilityThrows: DemoMatchUtilityThrow[] = utilityThrowFacts.map((u) => ({
    round_number: u.round_number,
    flasher_player_id: playerIdOf(u.flasher_steamid)!,
    blinded_player_id: playerIdOf(u.blinded_steamid)!,
    blind_duration: u.blind_duration,
    tick: u.tick,
  }));

  const roundEconomyFacts = collectMatchRoundEconomy(freezeEndEvents, equipmentRows, context, steamIds);
  const matchRoundEconomy: DemoMatchRoundEconomy[] = roundEconomyFacts.map((e) => ({
    round_number: e.round_number,
    player_id: playerIdOf(e.player_steamid)!,
    economy_type: e.economy_type,
    equipment_value: e.equipment_value,
  }));

  // 6. Merge with zero defaults
  const sabremetrics: DemoSabremetricStat[] = steamIds.map((steamId) => ({
    player_id: steamToPlayer.get(steamId)!.player_id,
    sabremetrics: {
      ...ZERO,
      ...accStats.get(steamId),
      ...kastStats.get(steamId),
      ...utilityStats.get(steamId),
      ...objectiveStats.get(steamId),
      ...tradeStats.get(steamId),
      ...heStats.get(steamId),
      ...accuracyStats.get(steamId),
      ...counterStrafeStats.get(steamId),
      ...sprayStats.get(steamId),
      ...smokeStats.get(steamId),
      ...unusedUtilStats.get(steamId),
      ...reloadStats.get(steamId),
    },
  }));

  const weaponStats: DemoWeaponStat[] = steamIds.map((steamId) => ({
    player_id: steamToPlayer.get(steamId)!.player_id,
    // `row.bucket` is the exact weapon classname (#474) — `collectWeaponClassStats()` only ever
    // buckets guns, so `WEAPON_CATEGORY[row.bucket]` is always defined here.
    weaponStats: weaponClassStats.get(steamId)!.map((row) => ({
      weapon: row.bucket,
      weapon_category: WEAPON_CATEGORY[row.bucket],
      shots_fired: row.shots_fired,
      shots_hit: row.shots_hit,
      headshot_hits: row.headshot_hits,
      damage_dealt: row.damage_dealt,
      rounds_played: row.rounds_played,
    })),
    economyStats: economyStats.get(steamId)!.map((row) => ({
      economy_type: row.bucket,
      shots_fired: row.shots_fired,
      shots_hit: row.shots_hit,
      headshot_hits: row.headshot_hits,
      damage_dealt: row.damage_dealt,
      rounds_played: row.rounds_played,
    })),
  }));

  // Deduplicate warnings
  const uniqueWarnings = [...new Set(warnings)];

  return {
    sabremetrics, weaponStats, matchKills, matchRounds, matchUtilityThrows, matchRoundEconomy,
    warnings: uniqueWarnings,
  };
}
