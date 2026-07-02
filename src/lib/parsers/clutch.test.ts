/**
 * Unit tests for collectClutch — 1v1/1v2 clutch detection. Exercises the "one side down to a lone
 * survivor while the enemy still has bodies" state machine: the 1v1 vs 1v2 branch, win detection off
 * the round's winnerSide, the >2-enemies-ignored cutoff, and the once-per-round "don't double count"
 * guard.
 *
 * Run:  npx tsx src/lib/parsers/clutch.test.ts
 */

import assert from 'node:assert/strict';
import { collectClutch } from './clutch';
import { makeContext, death } from './matchContextFixture';

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`${name}\n    ${(err as Error).message.replace(/\n/g, '\n    ')}`);
  }
}

test('collectClutch: 1v1 attempt + win is credited to the lone survivor on the winning side', () => {
  // 2v2: a,b CT vs c,d T. c dies (T down to 1v2 vs CT's 2) then b dies (CT down to 1v1: a vs d).
  // Round won by CT -> a's 1v1 is a win; d's 1v2 attempt (recorded when c died) is a loss.
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

test('collectClutch: a clutch is only recorded once even if more enemies die afterward', () => {
  // a alone vs c,d (1v2). Then c also dies -> a is now 1v1, but should NOT get a second (1v1) entry
  // credited on top of the 1v2 — the player was already marked as "in a clutch" this round.
  const sides = { a: 'CT', b: 'CT', c: 'T', d: 'T' } as const;
  const ids = Object.keys(sides);
  const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const }];
  const deaths = [
    death({ round: 1, tick: 100, victim: 'b', attacker: 'c' }), // a now alone vs c,d (1v2)
    death({ round: 1, tick: 200, victim: 'c', attacker: 'a' }), // down to 1v1, but already recorded
  ];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectClutch(deaths, ctx, ids);

  assert.equal(out.get('a')?.clutch_1v2_attempts, 1);
  assert.equal(out.get('a')?.clutch_1v1_attempts ?? 0, 0);
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

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
