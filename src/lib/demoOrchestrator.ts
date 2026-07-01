import { parseEvent } from '@laihoe/demoparser2';
import type { RosterEntry } from './demoParser';
import type { SabFields, DemoSabremetricStat, ParsedDemoSabremetricsResult } from './types';
import { readDemoPlayers, resolveRoster } from './parsers/rosterResolver';
import { buildMatchContext, type PlayerDeathRow } from './parsers/matchContext';
import type { RoundEndRow } from './parsers/roundSides';
import { inferSkinsStartingSide, resolveEffectiveSide } from './parsers/sideInference';
import { collectAccumulators } from './parsers/accumulators';
import { collectEntry } from './parsers/entry';
import { collectKast } from './parsers/kast';
import { collectMultikill } from './parsers/multikill';
import { collectClutch } from './parsers/clutch';
import { collectUtility, type PlayerBlindRow, type WeaponFireRow } from './parsers/utility';
import { collectObjectives, type BombEventRow } from './parsers/objectives';

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
  utility_damage: 0,
  blind_duration_dealt: 0,
  enemies_flashed: 0,
  flashes_thrown: 0,
  teamflash_duration: 0,
  plants: 0,
  defuses: 0,
  two_k_rounds: 0,
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

  // 3. Build match context — resolve the starting side the same way parseDemoFile does
  // (stored wins; otherwise infer from the demo) so sabremetrics and the score agree.
  const sabLiveRounds = roundEndEvents.filter(
    (e) => !e.is_warmup_period && e.winner !== null && e.total_rounds_played > 0,
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
    },
  }));

  // Deduplicate warnings
  const uniqueWarnings = [...new Set(warnings)];

  return { sabremetrics, warnings: uniqueWarnings };
}
