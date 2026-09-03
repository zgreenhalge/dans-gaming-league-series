// Persistence for `match_round_economy` — one row per (round, player), resolved from `player_id`
// (what the collector works in) to `player_match_stats_id` (the DB's FK), same resolution
// `matchKills.ts`/`weaponStats.ts`/`sabremetrics.ts` already do via `resolvePlayerMatchStatsIds()`.

import type { DemoMatchRoundEconomy } from '../types';
import type { Database } from '../database.types';
import { resolvePlayerMatchStatsIds } from './_shared';
import { replaceMatchRows } from './factTables';

type RoundEconomyRow = Database['public']['Tables']['match_round_economy']['Insert'];

/** Replace this match's `match_round_economy` rows. A row whose player has no resolvable
 *  `player_match_stats` row for this match is dropped.
 *
 *  `pmsById` lets a caller that's already resolving it for sibling fact tables (a score confirm
 *  writes ~6 of these concurrently for the same match) pass its own map instead of this function
 *  re-querying `player_match_stats` redundantly — omit it to resolve independently. */
export async function persistMatchRoundEconomy(
  matchId: number,
  rows_: DemoMatchRoundEconomy[],
  pmsById?: Map<number, number>,
): Promise<void> {
  pmsById ??= await resolvePlayerMatchStatsIds(matchId);

  const rows: RoundEconomyRow[] = [];
  for (const e of rows_) {
    const pmsId = pmsById.get(e.player_id);
    if (!pmsId) continue;
    rows.push({
      match_id: matchId,
      round_number: e.round_number,
      player_match_stats_id: pmsId,
      economy_type: e.economy_type,
      equipment_value: e.equipment_value,
    });
  }

  await replaceMatchRows('match_round_economy', matchId, rows);
}

/** Delete all `match_round_economy` rows for a match — e.g. a re-entered score with no derivable
 *  economy data. */
export async function clearMatchRoundEconomy(matchId: number): Promise<void> {
  await replaceMatchRows('match_round_economy', matchId, []);
}
