import type { SabFields } from '../types';
import type { MatchContext, PlayerDeathRow } from './matchContext';

type CollectorOut = Map<string, Partial<SabFields>>;

export interface PlayerInventoryRow {
  tick: number;
  steamid: string;
  inventory: string[];
}

// Valve's buy-menu prices for grenades — stable CS2/CS:GO economy constants, not demo-derived.
const GRENADE_VALUE: Record<string, number> = {
  weapon_hegrenade: 300,
  weapon_flashbang: 200,
  weapon_smokegrenade: 300,
  weapon_molotov: 400,
  weapon_incgrenade: 600,
  weapon_decoy: 50,
};

/** Tick list demoOrchestrator.ts needs to fetch (via parseTicks, all players): one per death. */
export function neededInventoryTicks(deathEvents: PlayerDeathRow[], context: MatchContext): number[] {
  const ticks = new Set<number>();
  for (const d of deathEvents) {
    const round = d.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;
    ticks.add(d.tick);
  }
  return [...ticks];
}

/**
 * Unused Utility on Death (Leetify's glossary stat): the buy-menu value of grenades still held
 * at the moment of death, summed across a player's deaths. Reads demoparser2's synthetic
 * "inventory" tick field (a list of weapon classnames the player is currently holding) — this
 * field isn't documented in the installed package and isn't confirmed against a real DGLS demo.
 * demoOrchestrator.ts wraps the parseTicks call so a wrong field name degrades this stat to zero
 * instead of failing the whole ingestion pipeline. Verify against the first real reparse and
 * adjust the prop name/GRENADE_VALUE's keys if the numbers don't look sane.
 */
export function collectUnusedUtility(
  deathEvents: PlayerDeathRow[],
  inventoryRows: PlayerInventoryRow[],
  context: MatchContext,
  steamIds: string[],
): CollectorOut {
  const out: CollectorOut = new Map();
  const steamSet = new Set(steamIds);
  for (const sid of steamIds) out.set(sid, {});

  const inventoryByTickAndPlayer = new Map<string, string[]>();
  for (const row of inventoryRows) {
    inventoryByTickAndPlayer.set(`${row.tick}::${row.steamid}`, row.inventory);
  }

  for (const d of deathEvents) {
    const round = d.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;
    const victim = d.user_steamid;
    if (!victim || !steamSet.has(victim)) continue;

    const inventory = inventoryByTickAndPlayer.get(`${d.tick}::${victim}`) ?? [];
    let value = 0;
    for (const weapon of inventory) value += GRENADE_VALUE[weapon] ?? 0;

    const p = out.get(victim)!;
    p.unused_util_value_on_death_total = ((p.unused_util_value_on_death_total as number) ?? 0) + value;
  }

  return out;
}
