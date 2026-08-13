/**
 * Unit tests for `evaluateAutoCommit()` — the D5 trusted auto-commit predicate (#138). Every check
 * must hold for a match to skip the human Confirm step, so this locks each gate individually (in
 * the order the function checks them) plus the fully-eligible pass case.
 *
 * Run:  npx tsx src/lib/demo/autoCommit.test.ts
 */

import assert from 'node:assert/strict';
import { evaluateAutoCommit, type AutoCommitInput } from './autoCommit';
import { test, report } from '../test-support/miniTest';

function baseInput(overrides: Partial<AutoCommitInput> = {}): AutoCommitInput {
  return {
    quarantinePassed: true,
    warningCount: 0,
    skinsSideStored: true,
    alreadyPlayed: false,
    derived: { shirts: 13, skins: 9 },
    mapResult: { shirts: 13, skins: 9 },
    ...overrides,
  };
}

test('evaluateAutoCommit: eligible when every check passes', () => {
  assert.deepEqual(evaluateAutoCommit(baseInput()), { eligible: true });
});

test('evaluateAutoCommit: a match that already has a confirmed score is never auto-committed', () => {
  const r = evaluateAutoCommit(baseInput({ alreadyPlayed: true }));
  assert.equal(r.eligible, false);
  assert.ok(!r.eligible && /already has a confirmed score/.test(r.reason));
});

test('evaluateAutoCommit: quarantine failure blocks auto-commit', () => {
  const r = evaluateAutoCommit(baseInput({ quarantinePassed: false }));
  assert.equal(r.eligible, false);
  assert.ok(!r.eligible && /quarantined/.test(r.reason));
});

test('evaluateAutoCommit: any parser warning blocks auto-commit', () => {
  const r = evaluateAutoCommit(baseInput({ warningCount: 2 }));
  assert.equal(r.eligible, false);
  assert.ok(!r.eligible && /2 parser warning/.test(r.reason));
});

test('evaluateAutoCommit: a demo-inferred-only starting side blocks auto-commit', () => {
  const r = evaluateAutoCommit(baseInput({ skinsSideStored: false }));
  assert.equal(r.eligible, false);
  assert.ok(!r.eligible && /skins_starting_side not stored/.test(r.reason));
});

test('evaluateAutoCommit: no map_result yet blocks auto-commit', () => {
  const r = evaluateAutoCommit(baseInput({ mapResult: null }));
  assert.equal(r.eligible, false);
  assert.ok(!r.eligible && /no map_result received/.test(r.reason));
});

test('evaluateAutoCommit: demo score disagreeing with map_result blocks auto-commit', () => {
  const r = evaluateAutoCommit(
    baseInput({ derived: { shirts: 13, skins: 9 }, mapResult: { shirts: 13, skins: 10 } }),
  );
  assert.equal(r.eligible, false);
  assert.ok(!r.eligible && /disagrees with map_result/.test(r.reason));
});

report();
