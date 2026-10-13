import { canonicalSort, deriveAdr, deriveRwr, isPlayedScore } from './util';

/** The slice of a season's weeks `rankPlayersThroughWeek()` reads — satisfied by `WeekWithMatches`
 *  (queries/schedule.ts). */
export interface StandingsWeek {
  week_number: number;
  matches: {
    final_score: string | null;
    shirts_stats: StandingsStat[];
    skins_stats: StandingsStat[];
  }[];
}

interface StandingsStat {
  player_id: number;
  is_win: boolean;
  damage: number;
  rounds_won: number;
  rounds_played: number;
}

/**
 * Regular-season standings as they stood after `throughWeek`: every player with at least one played
 * match up to and including that week, ranked by `canonicalSort()` (Wins → RWR% → ADR) over the
 * same totals the season leaderboard aggregates — wins, rounds won/played, and `damage / rounds
 * played` for ADR. Returns player id → 1-indexed rank. Rank ties (identical on every key) keep
 * player-id order so the result is deterministic.
 */
export function rankPlayersThroughWeek(weeks: StandingsWeek[], throughWeek: number): Map<number, number> {
  const totals = new Map<number, { wins: number; rounds_won: number; rounds_played: number; damage: number }>();
  for (const w of weeks) {
    if (w.week_number > throughWeek) continue;
    for (const m of w.matches) {
      if (!isPlayedScore(m.final_score)) continue;
      for (const s of [...m.shirts_stats, ...m.skins_stats]) {
        const t = totals.get(s.player_id) ?? { wins: 0, rounds_won: 0, rounds_played: 0, damage: 0 };
        t.wins += s.is_win ? 1 : 0;
        t.rounds_won += s.rounds_won;
        t.rounds_played += s.rounds_played;
        t.damage += s.damage;
        totals.set(s.player_id, t);
      }
    }
  }
  const rows = [...totals].map(([player_id, t]) => ({
    player_id,
    matches_won: t.wins,
    rwr_percentage: deriveRwr({ total_rounds_played: t.rounds_played, total_rounds_won: t.rounds_won }),
    overall_adr: deriveAdr({ total_rounds_played: t.rounds_played, total_damage: t.damage }),
  }));
  rows.sort((a, b) => canonicalSort(a, b) || a.player_id - b.player_id);
  return new Map(rows.map((r, i) => [r.player_id, i + 1]));
}

export interface RankMovement {
  /** Rank before the week; `null` for a player with no played match before it. */
  before: number | null;
  /** Rank after the week. */
  after: number;
}

/** How each player who played in `weekNumber` moved in the season standings across it. */
export function rankMovementForWeek(weeks: StandingsWeek[], weekNumber: number): Map<number, RankMovement> {
  const before = rankPlayersThroughWeek(weeks, weekNumber - 1);
  const after = rankPlayersThroughWeek(weeks, weekNumber);
  const movement = new Map<number, RankMovement>();
  for (const [player_id, rank] of after) {
    movement.set(player_id, { before: before.get(player_id) ?? null, after: rank });
  }
  return movement;
}
