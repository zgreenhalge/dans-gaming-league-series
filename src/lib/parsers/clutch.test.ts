/**
 * Unit tests for collectClutch — 1v1/1v2 clutch detection, and the 2v1 numbers-advantage
 * detection that drives Choke Score's "2v1 losses" term. Exercises the "one side down to a lone
 * survivor while the enemy still has bodies" state machine: the 1v1 vs 1v2 branch, win detection off
 * the round's winnerSide, the >2-enemies-ignored cutoff, the additional 1v1 credit a 1v2 clutcher
 * picks up when the enemy count later drops to 1, and the 2v1 branch, where both alive teammates
 * share the attempt/win credit.
 *
 * Run:  npx vitest run src/lib/parsers/clutch.test.ts
 */

import assert from 'node:assert/strict';
import { collectClutch } from './clutch';
import { makeContext, death } from './matchContextFixture';
import { test, report } from '../test-support/miniTest';

test('collectClutch: a 1v2 clutcher who fights down to a 1v1 keeps the 1v2 credit and also picks up the 1v1', () => {
  // 2v2: a,b CT vs c,d T. c dies (T down to 1v2 vs CT's 2) then b dies (CT down to 1v1: a vs d).
  // By the second death the round has narrowed to a real 1v1 between a and d, so d holds both a
  // 1v2 attempt (from the first death) and a 1v1 attempt (from the second). a's clutch state only
  // ever exists as a straight 1v1.
  // Round won by CT -> a's 1v1 is a win; d's 1v2 and 1v1 are both losses.
  const sides = { a: 'CT', b: 'CT', c: 'T', d: 'T' } as const;
  const ids = Object.keys(sides);
  const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const }];
  const deaths = [
    death({ round: 1, tick: 100, victim: 'c', attacker: 'a' }),
    death({ round: 1, tick: 200, victim: 'b', attacker: 'd' }),
  ];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectClutch(deaths, ctx, ids);

  assert.equal(out.get('d')?.clutch_1v2_attempts, 1);
  assert.equal(out.get('d')?.clutch_1v2_wins ?? 0, 0); // CT won, not T
  assert.equal(out.get('d')?.clutch_1v1_attempts, 1);
  assert.equal(out.get('d')?.clutch_1v1_wins ?? 0, 0); // CT won, not T
  assert.equal(out.get('a')?.clutch_1v1_attempts, 1);
  assert.equal(out.get('a')?.clutch_1v1_wins, 1);
});

test('collectClutch: enemy count > 2 is not tracked at all', () => {
  // 4v1: ct has 4, t has only e. e is down to 1 vs 4 enemies -> not a trackable clutch (1v3+).
  const sides = { a: 'CT', b: 'CT', c: 'CT', d: 'CT', e: 'T', f: 'T', g: 'T', h: 'T' } as const;
  const ids = Object.keys(sides);
  const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const }];
  const deaths = [
    death({ round: 1, tick: 100, victim: 'f', attacker: 'a' }),
    death({ round: 1, tick: 200, victim: 'g', attacker: 'a' }),
    death({ round: 1, tick: 300, victim: 'h', attacker: 'a' }),
  ];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectClutch(deaths, ctx, ids);

  assert.equal(out.get('e')?.clutch_1v1_attempts ?? 0, 0);
  assert.equal(out.get('e')?.clutch_1v2_attempts ?? 0, 0);
});

test('collectClutch: a 1v2 that narrows to a 1v1 credits both the 1v2 attempt and the later 1v1', () => {
  // a alone vs c,d (1v2). Then c also dies -> a is now 1v1 vs d. a holds both: the 1v2 attempt
  // from when teammate b died first, and a 1v1 attempt for the later, narrower duel against d.
  const sides = { a: 'CT', b: 'CT', c: 'T', d: 'T' } as const;
  const ids = Object.keys(sides);
  const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const }];
  const deaths = [
    death({ round: 1, tick: 100, victim: 'b', attacker: 'c' }), // a now alone vs c,d (1v2)
    death({ round: 1, tick: 200, victim: 'c', attacker: 'a' }), // narrows to 1v1 vs d
  ];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectClutch(deaths, ctx, ids);

  assert.equal(out.get('a')?.clutch_1v2_attempts, 1);
  assert.equal(out.get('a')?.clutch_1v2_wins, 1);
  assert.equal(out.get('a')?.clutch_1v1_attempts, 1);
  assert.equal(out.get('a')?.clutch_1v1_wins, 1);
});

test('collectClutch: nobody down to a lone survivor yet means no clutch at all', () => {
  // 3v3, one death: T goes from 3 to 2 -- still not a lone survivor on either side.
  const sides = { a: 'CT', b: 'CT', c: 'CT', d: 'T', e: 'T', f: 'T' } as const;
  const ids = Object.keys(sides);
  const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const }];
  const deaths = [death({ round: 1, tick: 100, victim: 'f', attacker: 'a' })];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectClutch(deaths, ctx, ids);

  for (const sid of ids) {
    assert.equal(out.get(sid)?.clutch_1v1_attempts ?? 0, 0);
    assert.equal(out.get(sid)?.clutch_1v2_attempts ?? 0, 0);
  }
});

test('collectClutch: a 2v1 numbers advantage is credited as a loss for both alive teammates when the round is lost', () => {
  const sides = { a: 'CT', b: 'CT', c: 'T', d: 'T' } as const;
  const ids = Object.keys(sides);
  const rounds = [{ roundNumber: 1, winnerSide: 'T' as const }];
  const deaths = [death({ round: 1, tick: 100, victim: 'd', attacker: 'a' })]; // CT now 2v1: a,b alive vs c
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectClutch(deaths, ctx, ids);

  assert.equal(out.get('a')?.clutch_2v1_attempts, 1);
  assert.equal(out.get('a')?.clutch_2v1_wins ?? 0, 0);
  assert.equal(out.get('b')?.clutch_2v1_attempts, 1);
  assert.equal(out.get('b')?.clutch_2v1_wins ?? 0, 0);
});

test('collectClutch: a 2v1 numbers advantage is credited as a win for both alive teammates when the round is won', () => {
  const sides = { a: 'CT', b: 'CT', c: 'T', d: 'T' } as const;
  const ids = Object.keys(sides);
  const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const }];
  const deaths = [death({ round: 1, tick: 100, victim: 'd', attacker: 'a' })];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectClutch(deaths, ctx, ids);

  assert.equal(out.get('a')?.clutch_2v1_attempts, 1);
  assert.equal(out.get('a')?.clutch_2v1_wins, 1);
  assert.equal(out.get('b')?.clutch_2v1_attempts, 1);
  assert.equal(out.get('b')?.clutch_2v1_wins, 1);
});

test('collectClutch: blowing a 2v1 advantage down to a 1v1 credits both the 2v1 attempt and the later 1v1 clutch', () => {
  const sides = { a: 'CT', b: 'CT', c: 'T', d: 'T' } as const;
  const ids = Object.keys(sides);
  const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const }];
  const deaths = [
    death({ round: 1, tick: 100, victim: 'd', attacker: 'a' }), // CT 2v1: a,b alive vs c
    death({ round: 1, tick: 200, victim: 'b', attacker: 'c' }), // CT down to 1v1: a vs c
  ];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectClutch(deaths, ctx, ids);

  assert.equal(out.get('a')?.clutch_2v1_attempts, 1);
  assert.equal(out.get('b')?.clutch_2v1_attempts, 1);
  assert.equal(out.get('a')?.clutch_1v1_attempts, 1);
  assert.equal(out.get('a')?.clutch_1v1_wins, 1);
});

test('collectClutch: a player outnumbered 3+ is not locked out of a real 1v2 once teammates trim the enemy count', () => {
  // 4v1 (a alone vs e,f,g,h from the start). While a is still outnumbered 3-to-1 (untracked,
  // enemyCount>2), a must not be marked "recorded" — otherwise the later, genuinely trackable
  // 1v2 (once one more enemy dies) would be silently skipped as "already recorded".
  const sides = { a: 'CT', e: 'T', f: 'T', g: 'T', h: 'T' } as const;
  const ids = Object.keys(sides);
  const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const }];
  const deaths = [
    death({ round: 1, tick: 100, victim: 'f', attacker: 'a' }), // a now 1v3 (untracked, >2)
    death({ round: 1, tick: 200, victim: 'g', attacker: 'a' }), // a now 1v2 — first trackable state
  ];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectClutch(deaths, ctx, ids);

  assert.equal(out.get('a')?.clutch_1v2_attempts, 1);
  assert.equal(out.get('a')?.clutch_1v2_wins, 1);
});

report();
