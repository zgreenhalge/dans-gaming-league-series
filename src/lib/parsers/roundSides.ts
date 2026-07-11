export interface RoundEndRow {
  tick: number;
  total_rounds_played: number;
  winner: string | null;
  is_warmup_period: boolean | number;
}

export interface RoundSideInfo {
  roundNumber: number;
  endTick: number;
  winnerSide: 'CT' | 'T' | null;
  shirtsSide: 'CT' | 'T';
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
export function buildRoundSides(
  roundEndEvents: RoundEndRow[],
  skinsStartingSide: 'CT' | 'T' | null,
  targetWinRounds: number,
  matchStartTick = 0,
): RoundSideInfo[] {
  if (skinsStartingSide === null) return [];

  const shirtsStartSide: 'CT' | 'T' = skinsStartingSide === 'CT' ? 'T' : 'CT';
  const shirtsOtherSide: 'CT' | 'T' = shirtsStartSide === 'CT' ? 'T' : 'CT';
  const regRoundsPerHalf = targetWinRounds - 1;
  const OT_ROUNDS_PER_HALF = 3;

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
    let shirtsSide: 'CT' | 'T';

    if (realRoundNumber <= regRoundsPerHalf) {
      shirtsSide = shirtsStartSide;
    } else if (realRoundNumber <= regRoundsPerHalf * 2) {
      shirtsSide = shirtsOtherSide;
    } else {
      const otRound = realRoundNumber - regRoundsPerHalf * 2;
      const otHalf = Math.ceil(otRound / OT_ROUNDS_PER_HALF);
      shirtsSide = otHalf % 2 === 1 ? shirtsOtherSide : shirtsStartSide;
    }

    return {
      roundNumber,
      endTick: e.tick,
      winnerSide: e.winner as 'CT' | 'T' | null,
      shirtsSide,
    };
  });
}

export function sideForFaction(
  info: RoundSideInfo,
  faction: 'SHIRTS' | 'SKINS',
): 'CT' | 'T' {
  if (faction === 'SHIRTS') return info.shirtsSide;
  return info.shirtsSide === 'CT' ? 'T' : 'CT';
}
