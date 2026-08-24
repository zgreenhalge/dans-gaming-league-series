import type { RoundCondition } from '../types';

export interface RoundEndRow {
  tick: number;
  total_rounds_played: number;
  winner: string | null;
  is_warmup_period: boolean | number;
  reason: string | null;
}

export interface RoundSideInfo {
  roundNumber: number;
  endTick: number;
  winnerSide: 'CT' | 'T' | null;
  shirtsSide: 'CT' | 'T';
  winReason: RoundCondition;
}

/** Maps a CS2 round_end `reason` to the win-condition icon bucket. The one place this mapping is
 *  defined — both the replay pipeline (`extract.ts`) and round persistence (`buildRoundSides`) import
 *  it from here so they can't drift apart. */
export function reasonToCondition(reason: string | null): RoundCondition {
  switch (reason) {
    case 'bomb_exploded':
      return 'bomb';
    case 'bomb_defused':
      return 'defuse';
    case 'time_ran_out':
    case 't_saved':
      return 'time';
    default:
      return 'elim';
  }
}

/**
 * @param matchStartTick  Tick the live match begins at (see `findMatchStartTick`). Any round_end
 *   before it is warmup or an erroneously-recorded knife round and is dropped. Survivors keep their
 *   engine `total_rounds_played` as their `roundNumber` (not a 1..N renumbering), since that's what
 *   round-death/hurt events and the accumulator ticks are keyed by. The half-swap boundary, however,
 *   is computed relative to the *first surviving round*, not the raw engine number: a knife round
 *   played before the live match shifts every real round's engine number up by however many stray
 *   rounds the engine counted, but the actual in-game halftime swap still lands after
 *   `regRoundsPerHalf` *real* rounds. Comparing the raw engine number directly against
 *   `regRoundsPerHalf` would move the swap boundary earlier by that same shift and mislabel the
 *   round straddling it. Defaults to 0 (no tick filtering).
 */
const OT_ROUNDS_PER_HALF = 3;

/**
 * Which side a team starting on `startingSide` plays in 1-based *real* round number
 * `realRoundNumber` (post-knife-round renumbering), applying the regulation-half swap at
 * `targetWinRounds - 1` rounds and the every-`OT_ROUNDS_PER_HALF` OT swap beyond it. The
 * canonical side-assignment rule (see `docs/calculations.md`'s "Side Splits") — both
 * `buildRoundSides` (per recorded round) and `roundsPlayedBySide` (a rounds-played total,
 * with no per-round event data) derive from this one function so they can't drift apart.
 */
function sideForRealRound(
  realRoundNumber: number,
  startingSide: 'CT' | 'T',
  targetWinRounds: number,
): 'CT' | 'T' {
  const otherSide: 'CT' | 'T' = startingSide === 'CT' ? 'T' : 'CT';
  const regRoundsPerHalf = targetWinRounds - 1;

  if (realRoundNumber <= regRoundsPerHalf) return startingSide;
  if (realRoundNumber <= regRoundsPerHalf * 2) return otherSide;
  const otRound = realRoundNumber - regRoundsPerHalf * 2;
  const otHalf = Math.ceil(otRound / OT_ROUNDS_PER_HALF);
  return otHalf % 2 === 1 ? otherSide : startingSide;
}

export function buildRoundSides(
  roundEndEvents: RoundEndRow[],
  skinsStartingSide: 'CT' | 'T' | null,
  targetWinRounds: number,
  matchStartTick = 0,
): RoundSideInfo[] {
  if (skinsStartingSide === null) return [];

  const shirtsStartSide: 'CT' | 'T' = skinsStartingSide === 'CT' ? 'T' : 'CT';

  const liveRounds = roundEndEvents.filter(
    (e) =>
      !e.is_warmup_period &&
      e.winner !== null &&
      e.total_rounds_played > 0 &&
      e.tick >= matchStartTick,
  );

  const firstRoundNumber = liveRounds.length > 0 ? liveRounds[0].total_rounds_played : 0;

  return liveRounds.map((e) => {
    const roundNumber = e.total_rounds_played;
    const realRoundNumber = roundNumber - firstRoundNumber + 1;

    return {
      roundNumber,
      endTick: e.tick,
      winnerSide: e.winner as 'CT' | 'T' | null,
      shirtsSide: sideForRealRound(realRoundNumber, shirtsStartSide, targetWinRounds),
      winReason: reasonToCondition(e.reason),
    };
  });
}

/**
 * How many of a team's `roundsPlayed` rounds (1-based real round order) were played on CT
 * vs T, derived from the same half/OT swap schedule as `buildRoundSides` — no per-round
 * event data needed, just the team's starting side and the season's `target_win_rounds`.
 * Used to side-scope per-round rate stats (e.g. ADR by side) where only a rounds-played
 * total, not a side-by-round breakdown, is stored per player.
 */
export function roundsPlayedBySide(
  startingSide: 'CT' | 'T' | null,
  roundsPlayed: number,
  targetWinRounds: number,
): { ct: number; t: number } {
  if (startingSide === null || roundsPlayed <= 0) return { ct: 0, t: 0 };
  let ct = 0;
  let t = 0;
  for (let n = 1; n <= roundsPlayed; n++) {
    if (sideForRealRound(n, startingSide, targetWinRounds) === 'CT') ct++;
    else t++;
  }
  return { ct, t };
}

export function sideForFaction(
  info: RoundSideInfo,
  faction: 'SHIRTS' | 'SKINS',
): 'CT' | 'T' {
  if (faction === 'SHIRTS') return info.shirtsSide;
  return info.shirtsSide === 'CT' ? 'T' : 'CT';
}
