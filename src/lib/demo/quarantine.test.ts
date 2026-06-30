/**
 * Unit tests for the demo quarantine heuristics (Phase 3, DatHost + MatchZy). Synthetic inputs only,
 * so this is fast and dependency-free — it proves each flag fires and that clean matches pass. A
 * real *messy* demo (backup/restore) is validated separately during the Phase-0/3 spike; here we
 * lock the logic so a refactor can't silently stop quarantining bad demos.
 *
 * Run:  npx tsx src/lib/demo/quarantine.test.ts
 */

import assert from 'node:assert/strict';
import { quarantineDemo } from './quarantine';
import type { RoundHistoryEntry } from '../types';

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

/** Build a clean N-round history that ends 13–8 (SHIRTS win), as a stand-in for a real one. */
function cleanHistory(n: number): RoundHistoryEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    n: i + 1,
    winner: i % 2 === 0 ? 'SHIRTS' : 'SKINS',
    side: 'CT',
    condition: 'elim',
  }));
}

// --- clean regulation match passes ---
test('clean 13–8 regulation match is not quarantined', () => {
  const r = quarantineDemo({
    roundHistory: cleanHistory(21),
    shirtsScore: 13,
    skinsScore: 8,
    targetWinRounds: 13,
  });
  assert.equal(r.ok, true, `expected ok, got flags: ${r.flags.join('; ')}`);
  assert.deepEqual(r.flags, []);
});

// --- clean overtime match passes (winner above target) ---
test('clean overtime match (16–14) is not quarantined', () => {
  const r = quarantineDemo({
    roundHistory: cleanHistory(30),
    shirtsScore: 16,
    skinsScore: 14,
    targetWinRounds: 13,
  });
  assert.equal(r.ok, true, `expected ok, got flags: ${r.flags.join('; ')}`);
});

// --- incomplete / abandoned match flagged ---
test('incomplete match (neither side reached target) is quarantined', () => {
  const r = quarantineDemo({
    roundHistory: cleanHistory(15),
    shirtsScore: 9,
    skinsScore: 6,
    targetWinRounds: 13,
  });
  assert.equal(r.ok, false);
  assert.ok(r.flags.some((f) => /incomplete or abandoned/.test(f)), r.flags.join('; '));
});

// --- round_history / score disagreement flagged ---
test('round_history length not matching the score is quarantined', () => {
  const r = quarantineDemo({
    roundHistory: cleanHistory(20), // 20 rounds…
    shirtsScore: 13,
    skinsScore: 8, // …but score totals 21
    targetWinRounds: 13,
  });
  assert.equal(r.ok, false);
  assert.ok(r.flags.some((f) => /round_history has 20 rounds/.test(f)), r.flags.join('; '));
});

// --- raw round regression (backup/restore) flagged ---
test('non-monotonic raw round numbers (backup/restore) are quarantined', () => {
  const rawRounds = [
    { n: 1, tick: 100 },
    { n: 2, tick: 200 },
    { n: 3, tick: 300 },
    { n: 2, tick: 250 }, // restored to before round 3
    { n: 3, tick: 360 },
  ];
  const r = quarantineDemo({
    roundHistory: null,
    shirtsScore: null,
    skinsScore: null,
    targetWinRounds: 13,
    rawRounds,
  });
  assert.equal(r.ok, false);
  assert.ok(r.flags.some((f) => /did not increase/.test(f)), r.flags.join('; '));
});

// --- duplicate raw end tick flagged ---
test('duplicate raw round-end tick is quarantined', () => {
  const rawRounds = [
    { n: 1, tick: 100 },
    { n: 2, tick: 200 },
    { n: 3, tick: 200 }, // duplicate tick
  ];
  const r = quarantineDemo({
    roundHistory: null,
    shirtsScore: null,
    skinsScore: null,
    targetWinRounds: 13,
    rawRounds,
  });
  assert.equal(r.ok, false);
  assert.ok(r.flags.some((f) => /duplicate round-end tick/.test(f)), r.flags.join('; '));
});

// --- unknown side (null scores) doesn't false-positive on the count check ---
test('unknown-side parse (null scores) is not quarantined on counts alone', () => {
  const r = quarantineDemo({
    roundHistory: cleanHistory(21),
    shirtsScore: null,
    skinsScore: null,
    targetWinRounds: 13,
  });
  assert.equal(r.ok, true, `expected ok, got flags: ${r.flags.join('; ')}`);
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
