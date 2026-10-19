/**
 * Unit tests for isVetoComplete — gates server provisioning (the incomplete->complete transition
 * fires it), so both the gauntlet shape (4 bans, no pick/side) and the regular shape (bans + pick +
 * starting side) need their own case, plus that a partial set of fields in either shape isn't
 * mistaken for complete.
 *
 * Run:  npx vitest run src/lib/veto.test.ts
 */

import assert from 'node:assert/strict';
import { effectiveSkinsStartingSide, isVetoComplete, type VetoFields } from './veto';
import { test, report } from './test-support/miniTest';

const full: VetoFields = {
  shirts_ban: 'Palais',
  shirts_ban2: 'Nuke',
  skins_ban1: 'Vertigo',
  skins_ban2: 'Ascent',
  shirts_pick: 'Train Yard',
  skins_starting_side: 'CT',
};

test('isVetoComplete: gauntlet only needs the 4 bans', () => {
  const m: VetoFields = { ...full, shirts_pick: null, skins_starting_side: null };
  assert.equal(isVetoComplete(m, true), true);
});

test('isVetoComplete: gauntlet with a missing ban is incomplete', () => {
  const m: VetoFields = { ...full, shirts_pick: null, skins_starting_side: null, skins_ban2: null };
  assert.equal(isVetoComplete(m, true), false);
});

test('isVetoComplete: regular season needs bans + pick + starting side', () => {
  assert.equal(isVetoComplete(full, false), true);
});

test('isVetoComplete: regular season with all 4 bans but no pick is incomplete', () => {
  const m: VetoFields = { ...full, shirts_pick: null };
  assert.equal(isVetoComplete(m, false), false);
});

test('isVetoComplete: regular season is complete even without shirts_ban2 (not part of REGULAR_STEPS)', () => {
  const m: VetoFields = { ...full, shirts_ban2: null };
  assert.equal(isVetoComplete(m, false), true);
});

test('isVetoComplete: regular season with a missing ban is incomplete', () => {
  const m: VetoFields = { ...full, skins_ban1: null };
  assert.equal(isVetoComplete(m, false), false);
});

test('isVetoComplete: regular season with a pick but no starting side is incomplete', () => {
  const m: VetoFields = { ...full, skins_starting_side: null };
  assert.equal(isVetoComplete(m, false), false);
});

test('isVetoComplete: all-null is incomplete in both shapes', () => {
  const m: VetoFields = {
    shirts_ban: null,
    shirts_ban2: null,
    skins_ban1: null,
    skins_ban2: null,
    shirts_pick: null,
    skins_starting_side: null,
  };
  assert.equal(isVetoComplete(m, true), false);
  assert.equal(isVetoComplete(m, false), false);
});

test('effectiveSkinsStartingSide: a stored side wins over the demo-derived one', () => {
  const round_history = [{ n: 1, winner: 'SHIRTS' as const, side: 'CT' as const, condition: 'elim' as const }];
  assert.equal(effectiveSkinsStartingSide({ skins_starting_side: 'CT', round_history }), 'CT');
});

test('effectiveSkinsStartingSide: derives the side from the first recorded round when none is stored', () => {
  const rounds = (winner: 'SHIRTS' | 'SKINS', side: 'CT' | 'T') => [
    { n: 5, winner: 'SHIRTS' as const, side: 'T' as const, condition: 'elim' as const },
    { n: 3, winner, side, condition: 'elim' as const },
  ];
  assert.equal(effectiveSkinsStartingSide({ skins_starting_side: null, round_history: rounds('SKINS', 'T') }), 'T');
  assert.equal(effectiveSkinsStartingSide({ skins_starting_side: null, round_history: rounds('SHIRTS', 'CT') }), 'T');
  assert.equal(effectiveSkinsStartingSide({ skins_starting_side: null, round_history: rounds('SHIRTS', 'T') }), 'CT');
});

test('effectiveSkinsStartingSide: null when nothing is stored or recorded', () => {
  assert.equal(effectiveSkinsStartingSide({ skins_starting_side: null, round_history: null }), null);
  assert.equal(effectiveSkinsStartingSide({ skins_starting_side: null, round_history: [] }), null);
});

report();
