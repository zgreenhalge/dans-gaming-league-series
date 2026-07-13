import type { SabFields } from '../types';
import type { MatchContext, PlayerDeathRow } from './matchContext';

type CollectorOut = Map<string, Partial<SabFields>>;

export interface PlayerInventoryRow {
  tick: number;
  steamid: string;
  inventory: string[];
}

// Valve's buy-menu prices for grenades — stable CS2/CS:GO economy constants, not demo-derived.
// Keyed by demoparser2's "inventory" tick field, which reports the weapon's display name
// (e.g. "Smoke Grenade"), not its classname (confirmed against a real DGLS demo).
const GRENADE_VALUE: Record<string, number> = {
  'High Explosive Grenade': 300,
  Flashbang: 200,
  'Smoke Grenade': 300,
  Molotov: 400,
  'Incendiary Grenade': 600,
  'Decoy Grenade': 50,
};

// The engine strips a pawn's weapon services on the death tick itself, so "inventory" always
// reads empty exactly at d.tick (confirmed against a real DGLS demo) — the last tick before
// death is the last one where it reflects what the player was actually holding.
const PRE_DEATH_TICK_OFFSET = 1;

/** Tick list demoOrchestrator.ts needs to fetch (via parseTicks, all players): one per death. */
export function neededInventoryTicks(deathEvents: PlayerDeathRow[], context: MatchContext): number[] {
  const ticks = new Set<number>();
  for (const d of deathEvents) {
    const round = d.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;
    ticks.add(d.tick - PRE_DEATH_TICK_OFFSET);
  }
  return [...ticks];
}

/**
 * Unused Utility on Death (Leetify's glossary stat): the buy-menu value of grenades still held
 * at the moment of death, summed across a player's deaths. Reads demoparser2's synthetic
 * "inventory" tick field — a list of weapon display names (e.g. "Smoke Grenade"), not classnames
 * — for the player currently holding them, one tick before death (see PRE_DEATH_TICK_OFFSET).
 * demoOrchestrator.ts wraps the parseTicks call so a future parser change that breaks this field
 * degrades this stat to zero instead of failing the whole ingestion pipeline.
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

    const inventory = inventoryByTickAndPlayer.get(`${d.tick - PRE_DEATH_TICK_OFFSET}::${victim}`) ?? [];
    let value = 0;
    for (const weapon of inventory) value += GRENADE_VALUE[weapon] ?? 0;

    const p = out.get(victim)!;
    p.unused_util_value_on_death_total = ((p.unused_util_value_on_death_total as number) ?? 0) + value;
  }

  return out;
}
