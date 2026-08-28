/**
 * Unit tests for collectAccuracy — AWP-excluded head accuracy (#173 phase 3.3). The plain
 * shots_fired/shots_hit/headshot_hits totals this collector used to also compute are derived at
 * query time instead (deriveAccuracyTotals() in queries/weaponStats.ts, #457) — see
 * queries-weaponStats.test.ts for that coverage.
 *
 * Run:  npx vitest run src/lib/parsers/accuracy.test.ts
 */

import assert from 'node:assert/strict';
import { collectAccuracy } from './accuracy';
import { makeContext, hurt } from './matchContextFixture';
import { test, report } from '../test-support/miniTest';

const sides = { a: 'CT', b: 'CT', c: 'T', d: 'T' } as const;
const ids = Object.keys(sides);
const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const }];

test('collectAccuracy: a non-AWP gun hit on an enemy counts toward shots_hit_no_awp', () => {
  const hurts = [hurt({ round: 1, tick: 100, attacker: 'a', victim: 'c', weapon: 'ak47', dmgHealth: 27 })];
  const ctx = makeContext({ rounds, sides });
  const out = collectAccuracy(hurts, ctx, ids);
  assert.equal(out.get('a')?.shots_hit_no_awp, 1);
});

test('collectAccuracy: a headshot hitgroup counts toward headshot_hits_no_awp as well as shots_hit_no_awp', () => {
  const hurts = [hurt({ round: 1, tick: 100, attacker: 'a', victim: 'c', weapon: 'ak47', dmgHealth: 100, hitgroup: 'head' })];
  const ctx = makeContext({ rounds, sides });
  const out = collectAccuracy(hurts, ctx, ids);
  assert.equal(out.get('a')?.shots_hit_no_awp, 1);
  assert.equal(out.get('a')?.headshot_hits_no_awp, 1);
});

test('collectAccuracy: a non-head hitgroup does not count toward headshot_hits_no_awp', () => {
  const hurts = [hurt({ round: 1, tick: 100, attacker: 'a', victim: 'c', weapon: 'ak47', dmgHealth: 27, hitgroup: 'chest' })];
  const ctx = makeContext({ rounds, sides });
  const out = collectAccuracy(hurts, ctx, ids);
  assert.equal(out.get('a')?.headshot_hits_no_awp ?? 0, 0);
});

test('collectAccuracy: HE/molotov damage is not credited', () => {
  const hurts = [
    hurt({ round: 1, tick: 100, attacker: 'a', victim: 'c', weapon: 'hegrenade', dmgHealth: 40 }),
    hurt({ round: 1, tick: 150, attacker: 'a', victim: 'c', weapon: 'inferno', dmgHealth: 10 }),
  ];
  const ctx = makeContext({ rounds, sides });
  const out = collectAccuracy(hurts, ctx, ids);
  assert.equal(out.get('a')?.shots_hit_no_awp ?? 0, 0);
});

test('collectAccuracy: teamdamage and self-damage are not credited', () => {
  const hurts = [
    hurt({ round: 1, tick: 100, attacker: 'a', victim: 'b', weapon: 'ak47', dmgHealth: 27 }), // teammate
    hurt({ round: 1, tick: 150, attacker: 'a', victim: 'a', weapon: 'ak47', dmgHealth: 5 }), // self
  ];
  const ctx = makeContext({ rounds, sides });
  const out = collectAccuracy(hurts, ctx, ids);
  assert.equal(out.get('a')?.shots_hit_no_awp ?? 0, 0);
});

test('collectAccuracy: an AWP headshot is excluded entirely', () => {
  const hurts = [hurt({ round: 1, tick: 100, attacker: 'a', victim: 'c', weapon: 'awp', dmgHealth: 100, hitgroup: 'head' })];
  const ctx = makeContext({ rounds, sides });
  const out = collectAccuracy(hurts, ctx, ids);
  assert.equal(out.get('a')?.shots_hit_no_awp ?? 0, 0);
  assert.equal(out.get('a')?.headshot_hits_no_awp ?? 0, 0);
});

report();
