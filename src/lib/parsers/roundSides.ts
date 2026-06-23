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

export function buildRoundSides(
  roundEndEvents: RoundEndRow[],
  skinsStartingSide: 'CT' | 'T' | null,
  targetWinRounds: number,
): RoundSideInfo[] {
  if (skinsStartingSide === null) return [];

  const shirtsStartSide: 'CT' | 'T' = skinsStartingSide === 'CT' ? 'T' : 'CT';
  const shirtsOtherSide: 'CT' | 'T' = shirtsStartSide === 'CT' ? 'T' : 'CT';
  const regRoundsPerHalf = targetWinRounds - 1;
  const OT_ROUNDS_PER_HALF = 3;

  const liveRounds = roundEndEvents.filter(
    (e) => !e.is_warmup_period && e.winner !== null && e.total_rounds_played > 0,
  );

  return liveRounds.map((e) => {
    const roundNumber = e.total_rounds_played;
    let shirtsSide: 'CT' | 'T';

    if (roundNumber <= regRoundsPerHalf) {
      shirtsSide = shirtsStartSide;
    } else if (roundNumber <= regRoundsPerHalf * 2) {
      shirtsSide = shirtsOtherSide;
    } else {
      const otRound = roundNumber - regRoundsPerHalf * 2;
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
