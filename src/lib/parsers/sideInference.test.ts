/**
 * Unit tests for demo-based starting-side inference (#137). Synthetic inputs only —
 * proves the round-1 team → skins-side decision and the stored-wins precedence without
 * needing a real demo. Real demos are validated separately via the parity harness (the
 * inferred side must equal each stored `skins_starting_side`).
 *
 * Run:  npx tsx src/lib/parsers/sideInference.test.ts
 */

import assert from 'node:assert/strict';
import { decideSkinsSide, resolveEffectiveSide } from './sideInference';

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

const CT = 3;
const T = 2;
type Faction = 'SHIRTS' | 'SKINS';
function roster(entries: [string, Faction][]) {
  return new Map(entries.map(([sid, faction], i) => [sid, { player_id: i + 1, faction }]));
}

// --- decideSkinsSide ---
test('skins on T → T', () => {
  const r = roster([['s1', 'SKINS'], ['s2', 'SKINS'], ['h1', 'SHIRTS'], ['h2', 'SHIRTS']]);
  const teams = new Map([['s1', T], ['s2', T], ['h1', CT], ['h2', CT]]);
  assert.equal(decideSkinsSide(teams, r), 'T');
});

test('skins on CT → CT', () => {
  const r = roster([['s1', 'SKINS'], ['h1', 'SHIRTS']]);
  const teams = new Map([['s1', CT], ['h1', T]]);
  assert.equal(decideSkinsSide(teams, r), 'CT');
});

test('no SKINS resolved → inferred from SHIRTS (opposite side)', () => {
  const r = roster([['h1', 'SHIRTS'], ['h2', 'SHIRTS']]);
  const teams = new Map([['h1', CT], ['h2', CT]]); // shirts CT ⇒ skins T
  assert.equal(decideSkinsSide(teams, r), 'T');
});

test('no valid sides (spectator/unassigned) → null', () => {
  const r = roster([['s1', 'SKINS']]);
  const teams = new Map([['s1', 1]]); // spectator
  assert.equal(decideSkinsSide(teams, r), null);
});

test('a SKINS player missing from the tick → decided by the present one', () => {
  const r = roster([['s1', 'SKINS'], ['s2', 'SKINS']]);
  const teams = new Map([['s1', CT]]); // s2 not in the tick read
  assert.equal(decideSkinsSide(teams, r), 'CT');
});

// --- resolveEffectiveSide (stored wins) ---
test('stored present, agrees with demo → stored, no disagreement', () => {
  assert.deepEqual(resolveEffectiveSide('CT', 'CT'), { side: 'CT', disagreed: false });
});

test('stored present, disagrees with demo → stored wins, flagged', () => {
  assert.deepEqual(resolveEffectiveSide('CT', 'T'), { side: 'CT', disagreed: true });
});

test('no stored side (gauntlet) → demo-inferred side', () => {
  assert.deepEqual(resolveEffectiveSide(null, 'T'), { side: 'T', disagreed: false });
});

test('stored present, demo unknown → stored, no false disagreement', () => {
  assert.deepEqual(resolveEffectiveSide('CT', null), { side: 'CT', disagreed: false });
});

test('neither stored nor inferred → null', () => {
  assert.deepEqual(resolveEffectiveSide(null, null), { side: null, disagreed: false });
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
