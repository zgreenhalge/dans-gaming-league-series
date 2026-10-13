import { aggregatePlayerRecords, compareRecords, type ScorecardMatch } from './group-scorecard';

/** The slice of a season's weeks `rankPlayersThroughWeek()` reads — satisfied by `WeekWithMatches`
 *  (queries/schedule.ts). */
export interface StandingsWeek {
  week_number: number;
  matches: ScorecardMatch[];
}

/**
 * Regular-season standings as they stood after `throughWeek`: every player with at least one played
 * match up to and including that week, ranked Wins → RWR% → ADR (`compareRecords('wins')`) over the
 * same rollup the scorecards use, whose totals are the season leaderboard's — wins, rounds won/played,
 * and `damage / rounds played` for ADR. Returns player id → 1-indexed rank. Rank ties (identical on
 * every key) keep player-id order so the result is deterministic.
 */
export function rankPlayersThroughWeek(weeks: StandingsWeek[], throughWeek: number): Map<number, number> {
  const matches = weeks.filter((w) => w.week_number <= throughWeek).flatMap((w) => w.matches);
  const compare = compareRecords('wins');
  const rows = [...aggregatePlayerRecords(matches).values()].sort((a, b) => compare(a, b) || a.player_id - b.player_id);
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
