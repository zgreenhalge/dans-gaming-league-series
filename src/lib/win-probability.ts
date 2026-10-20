/** Pure logic behind the win-probability calculator (`/tools/win-probability`): a 2v2 matchup's
 *  odds from `predictWinProbability()` and the three ways four players can split into teams. */

import { isProvisional, predictWinProbability, type PlayerRating } from './ehog';

export interface Matchup {
  shirts: PlayerRating[];
  skins: PlayerRating[];
  /** Probability the shirts side wins; the skins side's is `1 - pShirtsWin`. */
  pShirtsWin: number;
  /** Any of the four players is still early in their rating history (`isProvisional()`). */
  provisional: boolean;
}

export function evaluateMatchup(shirts: PlayerRating[], skins: PlayerRating[]): Matchup {
  return { shirts, skins, pShirtsWin: predictWinProbability(shirts, skins), provisional: isProvisional(shirts, skins) };
}

/** How far a matchup is from a coin flip: 0 is dead even, 0.5 a certainty. */
export function lopsidedness(m: Matchup): number {
  return Math.abs(m.pShirtsWin - 0.5);
}

/** All three ways to split four players into two teams of two, most even first. The first listed
 *  player is always on the shirts side, so a split's orientation is stable. Ties keep split order. */
export function rankSplits(four: PlayerRating[]): Matchup[] {
  if (four.length !== 4) throw new Error(`rankSplits: need exactly 4 players, got ${four.length}`);
  const [a, b, c, d] = four;
  return [
    evaluateMatchup([a, b], [c, d]),
    evaluateMatchup([a, c], [b, d]),
    evaluateMatchup([a, d], [b, c]),
  ].sort((x, y) => lopsidedness(x) - lopsidedness(y));
}

/** True when the same player appears more than once among the picks (`null` is an empty slot). */
export function hasDuplicatePick(picks: (number | null)[]): boolean {
  const ids = picks.filter((id): id is number => id != null);
  return new Set(ids).size !== ids.length;
}
