// Persistence for `match_utility_throws` — one row per `player_blind` event, resolved from
// `player_id` (what the collector works in) to `player_match_stats_id` (the DB's FK), same
// resolution `matchKills.ts`/`weaponStats.ts`/`sabremetrics.ts` already do via
// `resolvePlayerMatchStatsIds()`.

import type { DemoMatchUtilityThrow } from '../types';
import type { Database } from '../database.types';
import { resolvePlayerMatchStatsIds } from './_shared';
import { replaceMatchRows } from './factTables';

type UtilityThrowRow = Database['public']['Tables']['match_utility_throws']['Insert'];

/** Replace this match's `match_utility_throws` rows. Unlike `match_kills` (victim required,
 *  attacker/assister optional), both `flasher`/`blinded` are `not null` — a throw whose flasher or
 *  blinded player has no resolvable `player_match_stats` row is dropped entirely rather than
 *  partially recorded.
 *
 *  `pmsById` lets a caller that's already resolving it for sibling fact tables (a score confirm
 *  writes ~6 of these concurrently for the same match) pass its own map instead of this function
 *  re-querying `player_match_stats` redundantly — omit it to resolve independently. */
export async function persistMatchUtilityThrows(
  matchId: number,
  throws: DemoMatchUtilityThrow[],
  pmsById?: Map<number, number>,
): Promise<void> {
  pmsById ??= await resolvePlayerMatchStatsIds(matchId);

  const rows: UtilityThrowRow[] = [];
  for (const u of throws) {
    const flasherPmsId = pmsById.get(u.flasher_player_id);
    const blindedPmsId = pmsById.get(u.blinded_player_id);
    if (!flasherPmsId || !blindedPmsId) continue;
    rows.push({
      match_id: matchId,
      round_number: u.round_number,
      flasher_player_match_stats_id: flasherPmsId,
      blinded_player_match_stats_id: blindedPmsId,
      blind_duration: u.blind_duration,
      tick: u.tick,
    });
  }

  await replaceMatchRows('match_utility_throws', matchId, rows);
}

/** Delete all `match_utility_throws` rows for a match — e.g. a re-entered score with no derivable
 *  throws. */
export async function clearMatchUtilityThrows(matchId: number): Promise<void> {
  await replaceMatchRows('match_utility_throws', matchId, []);
}
