/**
 * Scrim match lobby rules: which server states lock a match, the starting-side choices, and lineup
 * parsing.
 *
 * Run:  npx vitest run src/lib/scrim-matches.test.ts
 */

import assert from 'node:assert/strict';
import { test, report } from './test-support/miniTest';
import { flipPendingScrimSide, isScrimMatchEditable, parseScrimTeams, scrimSideChoiceOf, scrimSideColumns } from './scrim-matches';
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

test('scrimSideColumns: each choice stores the side SKINS start on; random stores none yet', () => {
  assert.deepEqual(scrimSideColumns('skins_t'), { skins_starting_side: 'T', scrim_random_side: false });
  assert.deepEqual(scrimSideColumns('shirts_t'), { skins_starting_side: 'CT', scrim_random_side: false });
  assert.deepEqual(scrimSideColumns('knife'), { skins_starting_side: null, scrim_random_side: false });
  assert.deepEqual(scrimSideColumns('random'), { skins_starting_side: null, scrim_random_side: true });
});

test('scrimSideChoiceOf: reads each choice back from what it stored', () => {
  for (const choice of ['skins_t', 'shirts_t', 'knife', 'random'] as const) {
    assert.equal(scrimSideChoiceOf(scrimSideColumns(choice)), choice);
  }
});

test('flipPendingScrimSide: a pending random side is flipped and stored; anything else is left alone', async () => {
  const db: FakeDb = {
    matches: [
      { id: 1, scrim_night_id: 5, skins_starting_side: null, scrim_random_side: true },
      { id: 2, scrim_night_id: 5, skins_starting_side: null, scrim_random_side: false },
    ],
  };
  const client = createFakeSupabaseClient(db) as never;
  await flipPendingScrimSide(client, 1, () => 0.1);
  await flipPendingScrimSide(client, 2, () => 0.1);
  assert.deepEqual(db.matches.map((m) => [m.skins_starting_side, m.scrim_random_side]), [['T', false], [null, false]]);
});

test('parseScrimTeams: two distinct positive ids per side', () => {
  assert.deepEqual(parseScrimTeams({ shirts: [1, 2], skins: [3, 4] }), { shirts: [1, 2], skins: [3, 4] });
  assert.equal(parseScrimTeams({ shirts: [1, 1], skins: [3, 4] }), null);
  assert.equal(parseScrimTeams({ shirts: [1, 2], skins: [3] }), null);
  assert.equal(parseScrimTeams({ shirts: [1, 2], skins: [3, 0] }), null);
  assert.equal(parseScrimTeams(null), null);
});

report();
