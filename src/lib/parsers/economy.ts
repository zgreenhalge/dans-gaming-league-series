import type { MatchContext } from './matchContext';
import { roundOf, type RoundBounds } from './_shared';

export type EconomyType = 'save' | 'eco' | 'force' | 'full_buy';

/** Display label for each tier — the one place this mapping lives, shared by the Economy sub-tab's
 *  tier picker/table (`SabremetricsLeaderboardView.tsx`) and the round-by-round chart's tooltip
 *  (`RoundEconomyChart.tsx`). */
export const ECONOMY_TYPE_LABEL: Record<EconomyType, string> = {
  save: 'Save',
  eco: 'Eco',
  force: 'Force',
  full_buy: 'Full Buy',
};

// CS2 buy-menu prices are fixed game data (not a per-league setting) — a rifle+armor costs the
// same on any server, so these stay hardcoded rather than configurable. Exported so the Economy
// sub-tab's tier picker can explain them (`EconomyFilterSelect`'s info tooltip,
// `SabremetricsLeaderboardView.tsx`) from the same numbers `classifyEconomy()` actually uses.
//
// Full-buy is decided by equipment value alone, and checked first — a complete kit is a full buy
// no matter how much money is left over. Full-buy is side-specific: a CT's complete kit costs
// meaningfully more than a T's (Kevlar+Helmet $1000 vs Kevlar $650, plus a CT-only $400 defuse
// kit — ~$750 more before weapons even enter it), so one flat threshold either misses
// cheap-but-complete T buys or lets an armor+utility-only CT round read as "full."
export const FULL_BUY_MIN_T = 3800;
export const FULL_BUY_MIN_CT = 4400;

/** Everything short of a full buy is classified by *bank balance* first, not equipment value:
 *  keeping at least this much in reserve after buying means the round was a deliberate,
 *  controlled buy (`save`/`eco` below); dropping under it means the round was a `force` —
 *  spending down into a risky low-cash position without ever completing a kit. Only within the
 *  "kept the bank healthy" branch does equipment value further split `save` (barely spent) from
 *  `eco` (spent something real) — see `ECO_EQUIP_MIN`. */
export const BANK_MIN = 2000;

/** Within the "kept `BANK_MIN`+ in reserve" branch, equipment value at or above this is `eco`
 *  (spent a real amount while still banking money); under it is `save` (bought next to nothing).
 *  Named as a minimum-to-clear, like `FULL_BUY_MIN_T/CT`/`BANK_MIN` above, so all three thresholds
 *  in `classifyEconomy()` read the same direction. */
export const ECO_EQUIP_MIN = 1000;

export interface RoundFreezeEndRow {
  tick: number;
  total_rounds_played: number;
}

export interface PlayerEquipmentRow {
  tick: number;
  steamid: string;
  equipmentValue: number;
  /** Cash left on hand after buying, at the same freeze-time-end tick as `equipmentValue`
   *  (`CCSPlayerController.m_iAccount`) — the primary signal splitting `force` from `save`/`eco`,
   *  see `BANK_MIN`. */
  remainingCash: number;
}

/** The full-buy equipment-value floor for a side — CT's complete kit costs more than T's (see
 *  `FULL_BUY_MIN_T`/`FULL_BUY_MIN_CT`'s comment). */
export function fullBuyMin(side: 'CT' | 'T'): number {
  return side === 'CT' ? FULL_BUY_MIN_CT : FULL_BUY_MIN_T;
}

/** A complete kit is `full_buy` regardless of what's left in the bank; short of that, the round is
 *  first split by whether the bank stayed healthy (`save`/`eco`) or got spent down (`force`), and
 *  only within the healthy-bank branch does equipment value further distinguish barely-bought
 *  (`save`) from a real partial buy (`eco`). See `BANK_MIN`/`ECO_EQUIP_MIN`'s own comments for
 *  the reasoning behind each cut. */
export function classifyEconomy(equipmentValue: number, remainingCash: number, side: 'CT' | 'T'): EconomyType {
  if (equipmentValue >= fullBuyMin(side)) return 'full_buy';
  if (remainingCash < BANK_MIN) return 'force';
  return equipmentValue >= ECO_EQUIP_MIN ? 'eco' : 'save';
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

/** Folds `collectMatchRoundEconomy()`'s flat rows into a `(steamid -> round -> tier)` map — the
 *  shape `collectEconomyStats()` (`weaponStats.ts`) needs for an O(1) per-shot tier lookup while
 *  it replays the same match. A separate export (not inlined into `classifyRoundEconomy()` below)
 *  so a caller that already has the flat rows in hand (`demoOrchestrator.ts`, which also persists
 *  them as-is) can reshape them without re-running the round/player scan a second time. */
export function foldRoundEconomyByPlayer(
  rows: RoundEconomyFactRow[],
  steamIds: string[],
): Map<string, Map<number, EconomyType>> {
  const out = new Map<string, Map<number, EconomyType>>();
  for (const sid of steamIds) out.set(sid, new Map());
  for (const row of rows) {
    out.get(row.player_steamid)?.set(row.round_number, row.economy_type);
  }
  return out;
}

/**
 * Classifies each player's economy tier (#279) for every live round — `collectMatchRoundEconomy()`
 * plus `foldRoundEconomyByPlayer()`, for a caller that wants the `(steamid -> round -> tier)` shape
 * without already having the flat rows on hand. One entry per (player, round); a round
 * `collectMatchRoundEconomy()` couldn't classify (parser miss, unresolvable side) is simply absent
 * here too.
 */
export function classifyRoundEconomy(
  freezeEndEvents: RoundFreezeEndRow[],
  equipmentRows: PlayerEquipmentRow[],
  context: MatchContext,
  steamIds: string[],
): Map<string, Map<number, EconomyType>> {
  const rows = collectMatchRoundEconomy(freezeEndEvents, equipmentRows, context, steamIds);
  return foldRoundEconomyByPlayer(rows, steamIds);
}
