import type { MatchContext } from './matchContext';
import { roundOf, type RoundBounds } from './_shared';

export type EconomyType = 'eco' | 'half_buy' | 'force_buy' | 'full_buy';

/** Display label for each tier — the one place this mapping lives, shared by the Economy sub-tab's
 *  tier picker/table (`SabremetricsLeaderboardView.tsx`) and the round-by-round chart's tooltip
 *  (`RoundEconomyChart.tsx`). */
export const ECONOMY_TYPE_LABEL: Record<EconomyType, string> = {
  eco: 'Eco',
  half_buy: 'Half Buy',
  force_buy: 'Force Buy',
  full_buy: 'Full Buy',
};

// CS2 buy-menu prices are fixed game data (not a per-league setting) — a rifle+armor costs the
// same on any server, so these stay hardcoded rather than configurable. Exported so the Economy
// sub-tab's tier picker can explain them (`EconomyFilterSelect`'s info tooltip,
// `SabremetricsLeaderboardView.tsx`) from the same numbers `classifyEconomy()` actually uses.
//
// Eco and the full-buy floor are the two thresholds a player's raw equipment value alone can
// resolve. Full-buy is side-specific: a CT's complete kit costs meaningfully more than a T's
// (Kevlar+Helmet $1000 vs Kevlar $650, plus a CT-only $400 defuse kit — ~$750 more before
// weapons even enter it), so one flat threshold either misses cheap-but-complete T buys or lets
// an armor+utility-only CT half-buy read as "full."
export const ECO_MAX = 2000;
export const FULL_BUY_MIN_T = 3800;
export const FULL_BUY_MIN_CT = 4400;

/** A player who ends freeze time with less than this left over spent essentially everything they
 *  had trying to gear up — a force buy — rather than deliberately holding money back for a
 *  future round (a half buy/save). This is the one signal equipment value alone can't provide:
 *  two players can land on an identical mid-tier loadout, one because they spent down to nothing
 *  scraping a kit together under pressure, the other because they chose to buy conservatively
 *  while sitting on a cushion. See https://www.leetify.com/blog/understanding-csgo-economy/ and
 *  https://steamcommunity.com/sharedfiles/filedetails/?id=3131965472 for the community-standard
 *  version of this framing (written for 5v5 team economy; adapted here to a per-player read,
 *  matching every other collector in this codebase).
 */
export const FORCE_BUY_MAX_REMAINING = 1000;

export interface RoundFreezeEndRow {
  tick: number;
  total_rounds_played: number;
}

export interface PlayerEquipmentRow {
  tick: number;
  steamid: string;
  equipmentValue: number;
  /** Cash left on hand after buying, at the same freeze-time-end tick as `equipmentValue`
   *  (`CCSPlayerController.m_iAccount`) — the force-buy-vs-half-buy signal, see
   *  `FORCE_BUY_MAX_REMAINING`. */
  remainingCash: number;
}

/** The full-buy equipment-value floor for a side — CT's complete kit costs more than T's (see
 *  `FULL_BUY_MIN_T`/`FULL_BUY_MIN_CT`'s comment). */
export function fullBuyMin(side: 'CT' | 'T'): number {
  return side === 'CT' ? FULL_BUY_MIN_CT : FULL_BUY_MIN_T;
}

export function classifyEconomy(equipmentValue: number, remainingCash: number, side: 'CT' | 'T'): EconomyType {
  if (equipmentValue < ECO_MAX) return 'eco';
  if (equipmentValue >= fullBuyMin(side)) return 'full_buy';
  return remainingCash < FORCE_BUY_MAX_REMAINING ? 'force_buy' : 'half_buy';
}

export interface RoundEconomyFactRow {
  round_number: number;
  player_steamid: string;
  economy_type: EconomyType;
  equipment_value: number;
}

/**
 * One row per (round, player) — a `match_round_economy` fact table row, round-grain like
 * `match_rounds` rather than shot-grain, since a round with zero shots fired still counts toward
 * its economy tier (see `classifyRoundEconomy()` below and docs/demo-ingestion.md). A round with no
 * matching tick-state row (parser miss), or no resolvable side for that player that round, is left
 * out entirely, same as `classifyRoundEconomy()`.
 */
export function collectMatchRoundEconomy(
  freezeEndEvents: RoundFreezeEndRow[],
  equipmentRows: PlayerEquipmentRow[],
  context: MatchContext,
  steamIds: string[],
): RoundEconomyFactRow[] {
  const steamSet = new Set(steamIds);
  const rows: RoundEconomyFactRow[] = [];

  const rowLookup = new Map<string, PlayerEquipmentRow>();
  for (const r of equipmentRows) rowLookup.set(`${r.steamid}::${r.tick}`, r);

  for (const e of freezeEndEvents) {
    const round = roundOf(e, context);
    if (round == null) continue;

    for (const sid of steamIds) {
      if (!steamSet.has(sid)) continue;
      const row = rowLookup.get(`${sid}::${e.tick}`);
      if (!row) continue;
      const side = context.playerSides.get(sid)?.get(round);
      if (!side) continue;
      rows.push({
        round_number: round,
        player_steamid: sid,
        economy_type: classifyEconomy(row.equipmentValue, row.remainingCash, side),
        equipment_value: row.equipmentValue,
      });
    }
  }

  return rows;
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
 * value and remaining cash at that round's freeze-time-end
 * (`CCSPlayerPawn.m_unFreezetimeEndEquipmentValue` / `CCSPlayerController.m_iAccount`, the former
 * confirmed against a real DGLS demo) plus their side that round (for the side-specific full-buy
 * floor). One entry per (player, round) — a round with no matching tick-state row (parser miss),
 * or no resolvable side, is left unclassified rather than guessed.
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
      const side = context.playerSides.get(sid)?.get(round);
      if (!side) continue;
      out.get(sid)!.set(round, classifyEconomy(row.equipmentValue, row.remainingCash, side));
    }
  }

  return out;
}
