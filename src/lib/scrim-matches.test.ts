/**
 * Scrim match lobby rules: which server states lock a match, the starting-side choices, and lineup
 * parsing.
 *
 * Run:  npx vitest run src/lib/scrim-matches.test.ts
 */

import assert from 'node:assert/strict';
import { test, report } from './test-support/miniTest';
import { isScrimMatchEditable, parseScrimTeams, resolveScrimSide, scrimSideChoiceOf } from './scrim-matches';

test('isScrimMatchEditable: open until scored or started; a failed start reopens it', () => {
  assert.equal(isScrimMatchEditable({ final_score: null, server_state: null }), true);
  assert.equal(isScrimMatchEditable({ final_score: null, server_state: 'failed' }), true);
  assert.equal(isScrimMatchEditable({ final_score: null, server_state: 'idle' }), true);
  for (const state of ['provisioning', 'live', 'tearing_down', 'done']) {
    assert.equal(isScrimMatchEditable({ final_score: null, server_state: state }), false, state);
  }
  assert.equal(isScrimMatchEditable({ final_score: '13-9', server_state: null }), false);
});

test('resolveScrimSide: each choice stores the side SKINS start on; random flips a coin', () => {
  assert.equal(resolveScrimSide('skins_t'), 'T');
  assert.equal(resolveScrimSide('shirts_t'), 'CT');
  assert.equal(resolveScrimSide('knife'), null);
  assert.equal(resolveScrimSide('random', () => 0.1), 'T');
  assert.equal(resolveScrimSide('random', () => 0.9), 'CT');
});

test('scrimSideChoiceOf: reads a stored side back as its lobby choice', () => {
  assert.equal(scrimSideChoiceOf('T'), 'skins_t');
  assert.equal(scrimSideChoiceOf('CT'), 'shirts_t');
  assert.equal(scrimSideChoiceOf(null), 'knife');
});

test('parseScrimTeams: two distinct positive ids per side', () => {
  assert.deepEqual(parseScrimTeams({ shirts: [1, 2], skins: [3, 4] }), { shirts: [1, 2], skins: [3, 4] });
  assert.equal(parseScrimTeams({ shirts: [1, 1], skins: [3, 4] }), null);
  assert.equal(parseScrimTeams({ shirts: [1, 2], skins: [3] }), null);
  assert.equal(parseScrimTeams({ shirts: [1, 2], skins: [3, 0] }), null);
  assert.equal(parseScrimTeams(null), null);
});

report();
