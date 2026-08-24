import type { MatchContext } from './matchContext';
import { roundOf, type RoundBounds } from './_shared';

export type EconomyType = 'eco' | 'force_buy' | 'full_buy';

// Standard CS round-economy cutoffs, applied per player rather than per-team average — Wingman's
// 2-player sides make the two nearly equivalent, and every other collector in this codebase is
// already per-player.
const ECO_MAX = 2000;
const FORCE_BUY_MAX = 3500;

export interface RoundFreezeEndRow {
  tick: number;
  total_rounds_played: number;
}

export interface PlayerEquipmentRow {
  tick: number;
  steamid: string;
  equipmentValue: number;
}

export function classifyEconomy(equipmentValue: number): EconomyType {
  if (equipmentValue < ECO_MAX) return 'eco';
  if (equipmentValue < FORCE_BUY_MAX) return 'force_buy';
  return 'full_buy';
}

/** Tick list demoOrchestrator.ts needs to fetch (via parseTicks, all players): one per live
 *  round's freeze-time-end. */
export function neededEconomyTicks(freezeEndEvents: RoundFreezeEndRow[], bounds: RoundBounds): number[] {
  const ticks = new Set<number>();
  for (const e of freezeEndEvents) {
    if (roundOf(e, bounds) == null) continue;
    ticks.add(e.tick);
  }
  return [...ticks];
}

/**
 * Classifies each player's economy tier (#279) for every live round, from their own equipment
 * value at that round's freeze-time-end (`CCSPlayerPawn.m_unFreezetimeEndEquipmentValue`,
 * confirmed against a real DGLS demo). One entry per (player, round) — a round with no matching
 * tick-state row (parser miss) is left unclassified rather than guessed.
 */
export function classifyRoundEconomy(
  freezeEndEvents: RoundFreezeEndRow[],
  equipmentRows: PlayerEquipmentRow[],
  context: MatchContext,
  steamIds: string[],
): Map<string, Map<number, EconomyType>> {
  const out = new Map<string, Map<number, EconomyType>>();
  const steamSet = new Set(steamIds);
  for (const sid of steamIds) out.set(sid, new Map());

  const rowLookup = new Map<string, PlayerEquipmentRow>();
  for (const r of equipmentRows) rowLookup.set(`${r.steamid}::${r.tick}`, r);

  for (const e of freezeEndEvents) {
    const round = roundOf(e, context);
    if (round == null) continue;

    for (const sid of steamIds) {
      if (!steamSet.has(sid)) continue;
      const row = rowLookup.get(`${sid}::${e.tick}`);
      if (!row) continue;
      out.get(sid)!.set(round, classifyEconomy(row.equipmentValue));
    }
  }

  return out;
}
