/**
 * Unit tests for collectUnusedUtility — Leetify's "Unused Utility on Death": the buy-menu value
 * of grenades still held at the moment of death, summed across a player's deaths. The
 * "inventory" tick field these rows represent is a demoOrchestrator.ts-side assumption (see
 * unusedUtility.ts) — these tests exercise the collector's own value-summing/round-filtering
 * logic given already-shaped inventory rows, not the parsing assumption itself.
 *
 * Run:  npx tsx src/lib/parsers/unusedUtility.test.ts
 */

import assert from 'node:assert/strict';
import { collectUnusedUtility, type PlayerInventoryRow } from './unusedUtility';
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

function inv(opts: { tick: number; steamid: string; inventory: string[] }): PlayerInventoryRow {
  return opts;
}

const sides = { a: 'CT', b: 'CT', c: 'T', d: 'T' } as const;
const ids = Object.keys(sides);
const rounds = [{ roundNumber: 1, winnerSide: 'CT' as const }];

test('collectUnusedUtility: sums buy-menu grenade values held at the death tick', () => {
  const deaths = [death({ round: 1, tick: 100, victim: 'c', attacker: 'a' })];
  const inventory = [inv({ tick: 100, steamid: 'c', inventory: ['weapon_hegrenade', 'weapon_flashbang'] })];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectUnusedUtility(deaths, inventory, ctx, ids);
  assert.equal(out.get('c')?.unused_util_value_on_death_total, 500); // 300 (HE) + 200 (flash)
});

test('collectUnusedUtility: an empty inventory at death contributes zero', () => {
  const deaths = [death({ round: 1, tick: 100, victim: 'c', attacker: 'a' })];
  const inventory = [inv({ tick: 100, steamid: 'c', inventory: [] })];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectUnusedUtility(deaths, inventory, ctx, ids);
  assert.equal(out.get('c')?.unused_util_value_on_death_total ?? 0, 0);
});

test('collectUnusedUtility: non-grenade weapons in the inventory are ignored', () => {
  const deaths = [death({ round: 1, tick: 100, victim: 'c', attacker: 'a' })];
  const inventory = [inv({ tick: 100, steamid: 'c', inventory: ['weapon_ak47', 'weapon_smokegrenade'] })];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectUnusedUtility(deaths, inventory, ctx, ids);
  assert.equal(out.get('c')?.unused_util_value_on_death_total, 300); // smoke only
});

test('collectUnusedUtility: sums across multiple deaths in the match', () => {
  const rounds2 = [{ roundNumber: 1, winnerSide: 'CT' as const }, { roundNumber: 2, winnerSide: 'T' as const }];
  const deaths = [
    death({ round: 1, tick: 100, victim: 'c', attacker: 'a' }),
    death({ round: 2, tick: 1100, victim: 'c', attacker: 'a' }),
  ];
  const inventory = [
    inv({ tick: 100, steamid: 'c', inventory: ['weapon_decoy'] }),
    inv({ tick: 1100, steamid: 'c', inventory: ['weapon_incgrenade'] }),
  ];
  const ctx = makeContext({ rounds: rounds2, sides, deaths });
  const out = collectUnusedUtility(deaths, inventory, ctx, ids);
  assert.equal(out.get('c')?.unused_util_value_on_death_total, 650); // 50 (decoy) + 600 (incendiary)
});

test('collectUnusedUtility: a missing inventory row for a death contributes zero, not a crash', () => {
  const deaths = [death({ round: 1, tick: 100, victim: 'c', attacker: 'a' })];
  const ctx = makeContext({ rounds, sides, deaths });
  const out = collectUnusedUtility(deaths, [], ctx, ids);
  assert.equal(out.get('c')?.unused_util_value_on_death_total ?? 0, 0);
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
