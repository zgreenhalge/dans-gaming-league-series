// Persistence for `match_rounds` — one row per round outcome. Match-scoped only (no per-player FK
// resolution needed, unlike `matchKills.ts`).

import type { DemoMatchRound } from '../types';
import type { Database } from '../database.types';
import { replaceMatchRows } from './factTables';

type RoundRow = Database['public']['Tables']['match_rounds']['Insert'];

/** Replace this match's `match_rounds` rows. */
export async function persistMatchRounds(matchId: number, rounds: DemoMatchRound[]): Promise<void> {
  const rows: RoundRow[] = rounds.map((r) => ({
    match_id: matchId,
    round_number: r.round_number,
    winner_side: r.winner_side,
    shirts_side: r.shirts_side,
    win_reason: r.win_reason,
  }));
  await replaceMatchRows('match_rounds', matchId, rows);
}

/** Delete all `match_rounds` rows for a match — e.g. a re-entered score with no derivable rounds. */
export async function clearMatchRounds(matchId: number): Promise<void> {
  await replaceMatchRows('match_rounds', matchId, []);
}
