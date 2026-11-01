/**
 * Scrim match lobby rules: which server states lock a match, the starting-side choices, and lineup
 * parsing.
 *
 * Run:  npx vitest run src/lib/scrim-matches.test.ts
 */

import assert from 'node:assert/strict';
import { test, report } from './test-support/miniTest';
import { applyScrimSideChoice, isScrimMatchEditable, parseScrimTeams, resolveScrimSide } from './scrim-matches';
import { createFakeSupabaseClient, type FakeDb } from './test-support/fakeSupabase';

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

test('applyScrimSideChoice: turns a scrim choice into the starting side; leaves a league match alone', async () => {
  const db: FakeDb = {
    matches: [
      { id: 1, scrim_night_id: 5, scrim_side_choice: 'random', skins_starting_side: null },
      { id: 2, scrim_night_id: 5, scrim_side_choice: 'shirts_t', skins_starting_side: null },
      { id: 3, scrim_night_id: 5, scrim_side_choice: 'knife', skins_starting_side: null },
      { id: 4, week_id: 10, scrim_night_id: null, scrim_side_choice: null, skins_starting_side: 'T' },
    ],
  };
  const client = createFakeSupabaseClient(db) as never;
  for (const id of [1, 2, 3, 4]) await applyScrimSideChoice(client, id, () => 0.9);
  assert.deepEqual(db.matches.map((m) => m.skins_starting_side), ['CT', 'CT', null, 'T']);
});

test('parseScrimTeams: two distinct positive ids per side', () => {
  assert.deepEqual(parseScrimTeams({ shirts: [1, 2], skins: [3, 4] }), { shirts: [1, 2], skins: [3, 4] });
  assert.equal(parseScrimTeams({ shirts: [1, 1], skins: [3, 4] }), null);
  assert.equal(parseScrimTeams({ shirts: [1, 2], skins: [3] }), null);
  assert.equal(parseScrimTeams({ shirts: [1, 2], skins: [3, 0] }), null);
  assert.equal(parseScrimTeams(null), null);
});

report();
