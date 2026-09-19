/**
 * Unit tests for demo-based starting-side inference (#137). Synthetic inputs only —
 * proves the round-1 team → skins-side decision and the stored-wins precedence without
 * needing a real demo. Real demos are validated separately via the parity harness (the
 * inferred side must equal each stored `skins_starting_side`).
 *
 * Run:  npx vitest run src/lib/parsers/sideInference.test.ts
 */

import assert from 'node:assert/strict';
import { decideSkinsSide, resolveEffectiveSide, anchorToRoundOne } from './sideInference';
import { sideForRealRound } from './roundSides';
import { test, report } from '../test-support/miniTest';

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

// --- anchorToRoundOne: recovering the round-1 side from a team_num read taken at a later round ---
//
// A demo segment that begins mid-match (e.g. the second half of a restart-interrupted match) has
// its first `team_num` read AFTER the halftime swap, not at the match's true round 1 — reading it
// naively would report the inverted side. This corrects for that using the same half/OT swap
// schedule `buildRoundSides` uses, given the segment's real starting round number.

test('anchorToRoundOne: a segment starting at real round 1 (the common case) is unchanged', () => {
  assert.equal(anchorToRoundOne('CT', 1, 13), 'CT');
  assert.equal(anchorToRoundOne('T', 1, 13), 'T');
});

test('anchorToRoundOne: null side passes through unchanged', () => {
  assert.equal(anchorToRoundOne(null, 13, 13), null);
});

test('anchorToRoundOne: a segment starting just past the halftime swap (real round 13, MR12) inverts', () => {
  // The demo's own team_num read at round 13 shows the post-swap side; the true round-1 anchor
  // for that team is the opposite.
  assert.equal(anchorToRoundOne('CT', 13, 13), 'T');
  assert.equal(anchorToRoundOne('T', 13, 13), 'CT');
});

test('anchorToRoundOne: round-trips against sideForRealRound for an arbitrary round/side/target', () => {
  // The correction is sideForRealRound's own inverse: whatever side a round-1 anchor of S produces
  // at round R, feeding that result back through anchorToRoundOne at the same R must recover S.
  for (const target of [13, 16]) {
    for (const round of [1, 5, 12, 13, 20, 25, 27, 28]) {
      for (const anchor of ['CT', 'T'] as const) {
        const sideAtRound = sideForRealRound(round, anchor, target);
        assert.equal(
          anchorToRoundOne(sideAtRound, round, target),
          anchor,
          `round=${round} target=${target} anchor=${anchor}`,
        );
      }
    }
  }
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

report();
