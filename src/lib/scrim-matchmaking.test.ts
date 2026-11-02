/**
 * Scrim night matchmaking: who plays next (fewest matches, then longest wait), which split (fewest
 * repeat teammates, then most even), side balance, and fairness over a simulated night.
 *
 * Run:  npx vitest run src/lib/scrim-matchmaking.test.ts
 */

import assert from 'node:assert/strict';
import { test, report } from './test-support/miniTest';
import { mulberry32, pairKey } from './season-schedule';
import { MU_DEFAULT, SIGMA_DEFAULT, toEhog, type PlayerRating } from './ehog';
import { pickNextFour, pickNextScrimMatch, type ScrimTeams } from './scrim-matchmaking';

function rated(playerId: number, mu = MU_DEFAULT, sigma = SIGMA_DEFAULT): PlayerRating {
  return { playerId, mu, sigma, ehogRating: toEhog(mu, sigma) };
}
const everyone = (n: number) => Array.from({ length: n }, (_, i) => rated(i + 1));
const idsIn = (m: ScrimTeams) => [...m.shirts, ...m.skins].sort((a, b) => a - b);

test('pickNextScrimMatch: null with fewer than four players', () => {
  assert.equal(pickNextScrimMatch(everyone(3), [], mulberry32(1)), null);
});

test('pickNextScrimMatch: exactly four players all play, each once', () => {
  const m = pickNextScrimMatch(everyone(4), [], mulberry32(1))!;
  assert.deepEqual(idsIn(m), [1, 2, 3, 4]);
});

test('pickNextFour: players who sat out go next', () => {
  const history: ScrimTeams[] = [{ shirts: [1, 2], skins: [3, 4] }];
  const four = pickNextFour([1, 2, 3, 4, 5, 6], history, mulberry32(7));
  assert.ok(four.includes(5) && four.includes(6));
});

test('pickNextFour: among equal counts, the longest-waiting player goes first', () => {
  // Everyone has played once; 1-4 played in match 0, 5-8 in match 1. 1-4 have waited longer.
  const history: ScrimTeams[] = [
    { shirts: [1, 2], skins: [3, 4] },
    { shirts: [5, 6], skins: [7, 8] },
  ];
  assert.deepEqual(pickNextFour([1, 2, 3, 4, 5, 6, 7, 8], history, mulberry32(3)).sort(), [1, 2, 3, 4]);
});

test('pickNextScrimMatch: avoids repeating a teammate pair when another split exists', () => {
  const history: ScrimTeams[] = [{ shirts: [1, 2], skins: [3, 4] }];
  const m = pickNextScrimMatch(everyone(4), history, mulberry32(5))!;
  assert.notEqual(pairKey(...m.shirts), pairKey(1, 2));
  assert.notEqual(pairKey(...m.skins), pairKey(1, 2));
  assert.notEqual(pairKey(...m.shirts), pairKey(3, 4));
  assert.notEqual(pairKey(...m.skins), pairKey(3, 4));
});

test('pickNextScrimMatch: with no repeats in play, pairs the strongest with the weakest', () => {
  const players = [rated(1, 35), rated(2, 30), rated(3, 20), rated(4, 15)];
  const m = pickNextScrimMatch(players, [], mulberry32(9))!;
  const team = (id: number) => (m.shirts.includes(id) ? m.shirts : m.skins);
  assert.ok(team(1).includes(4), 'the strongest and weakest share a team');
  assert.ok(Math.abs(m.pShirtsWin - 0.5) < 0.25);
});

test('pickNextScrimMatch: pShirtsWin follows the side the teams land on', () => {
  const players = [rated(1, 35), rated(2, 30), rated(3, 20), rated(4, 15)];
  // Each history makes chooseSides() orient the same teams differently.
  const plans = [
    pickNextScrimMatch(players, [], mulberry32(9))!,
    pickNextScrimMatch(players, [{ shirts: [1, 4], skins: [2, 3] }], mulberry32(9))!,
    pickNextScrimMatch(players, [{ shirts: [2, 3], skins: [1, 4] }], mulberry32(9))!,
  ];
  for (const plan of plans) {
    const shirtsMu = plan.shirts.reduce((s, id) => s + players.find((p) => p.playerId === id)!.mu, 0);
    const skinsMu = plan.skins.reduce((s, id) => s + players.find((p) => p.playerId === id)!.mu, 0);
    assert.equal(plan.pShirtsWin > 0.5, shirtsMu > skinsMu);
  }
});

test('a simulated night: match counts stay within one of each other, and sides stay even', () => {
  for (const size of [5, 6, 7, 9]) {
    const players = everyone(size);
    const history: ScrimTeams[] = [];
    const rand = mulberry32(size);
    for (let i = 0; i < 12; i++) history.push(pickNextScrimMatch(players, history, rand)!);

    const played = new Map<number, number>();
    const side = new Map<number, number>();
    for (const m of history) {
      for (const id of idsIn(m)) played.set(id, (played.get(id) ?? 0) + 1);
      for (const id of m.shirts) side.set(id, (side.get(id) ?? 0) + 1);
      for (const id of m.skins) side.set(id, (side.get(id) ?? 0) - 1);
    }
    const counts = players.map((p) => played.get(p.playerId) ?? 0);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `size ${size}: counts ${counts}`);
    assert.ok([...side.values()].every((v) => Math.abs(v) <= 2), `size ${size}: sides ${[...side.values()]}`);
  }
});

test('a late arrival is picked for the very next match', () => {
  const history: ScrimTeams[] = [];
  const rand = mulberry32(11);
  const early = everyone(5);
  for (let i = 0; i < 3; i++) history.push(pickNextScrimMatch(early, history, rand)!);
  const m = pickNextScrimMatch([...early, rated(6)], history, rand)!;
  assert.ok(idsIn(m).includes(6));
});

report();
