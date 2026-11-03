// Picks a scrim night's next 2v2 from whoever is checked in, one match at a time — attendance changes
// through the night, so there's no fixed schedule to build up front. Pure: ratings, the night's
// earlier matches and the random source all come in as arguments.
//
// Built from the season scheduler's pieces: `pairKey()` for who has partnered or faced whom,
// `rankSplits()` (`win-probability.ts`) for the most even EHOG split, and `chooseSides()` for
// shirts/skins balance.
//
//   1. Who plays: the four checked-in players with the fewest matches tonight, longest-waiting first;
//      ties are broken at random, so equal claims rotate fairly.
//   2. Teams: of the three ways to split those four, the one repeating the fewest teammate pairs
//      from earlier tonight, then the most even by EHOG win probability, then the fewest repeated
//      opponent pairs.
//   3. Sides: whichever orientation leaves the four players' shirts/skins counts most even.

import { SCRIM_MATCH_SIZE } from './scrim-schedule';
import type { PlayerRating } from './ehog';
import { pairKey, chooseSides } from './season-schedule';
import { rankSplits, lopsidedness } from './win-probability';
import { shuffled } from './season-format';

export interface ScrimTeams {
  shirts: [number, number];
  skins: [number, number];
}

export interface ScrimMatchPlan extends ScrimTeams {
  /** EHOG probability the shirts side wins. */
  pShirtsWin: number;
}


/** The four players who should play next: fewest matches tonight, then longest since their last
 *  one (never played counts as longest), with `rand` breaking remaining ties. */
export function pickNextFour(playerIds: number[], history: ScrimTeams[], rand: () => number): number[] {
  const played = new Map<number, number>();
  const lastPlayed = new Map<number, number>();
  history.forEach((m, i) => {
    for (const id of [...m.shirts, ...m.skins]) {
      played.set(id, (played.get(id) ?? 0) + 1);
      lastPlayed.set(id, i);
    }
  });
  return shuffled(playerIds, rand)
    .sort((a, b) => (played.get(a) ?? 0) - (played.get(b) ?? 0) || (lastPlayed.get(a) ?? -1) - (lastPlayed.get(b) ?? -1))
    .slice(0, SCRIM_MATCH_SIZE);
}

/**
 * The next match for the checked-in `players`, or `null` with fewer than four. `history` is the
 * night's earlier matches, oldest first.
 */
export function pickNextScrimMatch(players: PlayerRating[], history: ScrimTeams[], rand: () => number = Math.random): ScrimMatchPlan | null {
  if (players.length < SCRIM_MATCH_SIZE) return null;
  const byId = new Map(players.map((p) => [p.playerId, p]));
  const four = pickNextFour([...byId.keys()], history, rand).map((id) => byId.get(id)!);

  const teammates = new Set<string>();
  const opponents = new Set<string>();
  const balance = new Map<number, number>();
  for (const m of history) {
    teammates.add(pairKey(...m.shirts));
    teammates.add(pairKey(...m.skins));
    for (const a of m.shirts) for (const b of m.skins) opponents.add(pairKey(a, b));
    for (const id of m.shirts) balance.set(id, (balance.get(id) ?? 0) + 1);
    for (const id of m.skins) balance.set(id, (balance.get(id) ?? 0) - 1);
  }

  const ids = (team: PlayerRating[]) => [team[0].playerId, team[1].playerId] as [number, number];
  const repeatedTeammates = (a: [number, number], b: [number, number]) =>
    Number(teammates.has(pairKey(...a))) + Number(teammates.has(pairKey(...b)));
  const repeatedOpponents = (a: [number, number], b: [number, number]) =>
    a.reduce((n, x) => n + b.filter((y) => opponents.has(pairKey(x, y))).length, 0);

  // rankSplits() is already most-even first, so a stable sort on teammate repeats keeps that order
  // within each repeat count; opponent repeats only break exact-evenness ties.
  const [best] = rankSplits(four)
    .map((m) => ({ m, shirts: ids(m.shirts), skins: ids(m.skins) }))
    .sort(
      (x, y) =>
        repeatedTeammates(x.shirts, x.skins) - repeatedTeammates(y.shirts, y.skins) ||
        lopsidedness(x.m) - lopsidedness(y.m) ||
        repeatedOpponents(x.shirts, x.skins) - repeatedOpponents(y.shirts, y.skins),
    );

  const sided = chooseSides(best.shirts, best.skins, balance);
  const flipped = sided.shirts[0] !== best.shirts[0] && sided.shirts[0] !== best.shirts[1];
  return { shirts: sided.shirts, skins: sided.skins, pShirtsWin: flipped ? 1 - best.m.pShirtsWin : best.m.pShirtsWin };
}
