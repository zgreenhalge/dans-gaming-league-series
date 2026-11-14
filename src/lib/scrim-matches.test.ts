/**
 * Scrim match lobby rules: which server states lock a match, who may manage one, the starting-side
 * choices, lineup parsing, and the revision-checked writes' refusals.
 *
 * Run:  npx vitest run src/lib/scrim-matches.test.ts
 */

import assert from 'node:assert/strict';
import { test, report } from './test-support/miniTest';
import {
  applyScrimSideChoice,
  canManageScrimMatch,
  claimScrimMatchStart,
  discardScrimMatch,
  scrimMatchPlaysAfter,
  isScrimMatchDiscardable,
  isScrimMatchEditable,
  leagueMatchBlockingScrim,
  parseScrimRevision,
  parseScrimTeams,
  resolveScrimMap,
  resolveScrimSide,
  updateScrimMatch,
  ScrimMatchChangedError,
  ScrimMatchConflictError,
} from './scrim-matches';
import { createFakeSupabaseClient, type FakeDb } from './test-support/fakeSupabase';
import { scrimMatchRpcs } from './test-support/scrimMatchRpcs';

test('canManageScrimMatch: an admin or one of its players; nobody signed out', () => {
  assert.equal(canManageScrimMatch({ playerId: 1, isAdmin: true }, [2, 3, 4, 5]), true);
  assert.equal(canManageScrimMatch({ playerId: 3, isAdmin: false }, [2, 3, 4, 5]), true);
  assert.equal(canManageScrimMatch({ playerId: 9, isAdmin: false }, [2, 3, 4, 5]), false);
  assert.equal(canManageScrimMatch({ playerId: null, isAdmin: false }, [2, 3, 4, 5]), false);
});

test('parseScrimRevision: a non-negative integer', () => {
  assert.equal(parseScrimRevision(0), 0);
  assert.equal(parseScrimRevision(7), 7);
  for (const bad of [undefined, null, -1, 1.5, '3']) assert.equal(parseScrimRevision(bad), null, String(bad));
});

test('updateScrimMatch / discardScrimMatch / claimScrimMatchStart: each bumps or checks the revision; a stale one is refused as changed', async () => {
  const db: FakeDb = {
    matches: [{ id: 1, scrim_night_id: 5, scrim_revision: 0, scrim_side_choice: 'knife', skins_starting_side: null, final_score: null }],
    player_match_stats: [],
    match_server_state: [],
  };
  const client = createFakeSupabaseClient(db, scrimMatchRpcs) as never;
  assert.equal(await updateScrimMatch(client, 1, 0, { side: 'random', map: { name: 'Foroglio', workshopId: '111' } }), 1);
  assert.deepEqual([db.matches[0].scrim_side_choice, db.matches[0].shirts_pick, db.matches[0].scrim_workshop_id], ['random', 'Foroglio', '111']);
  await assert.rejects(updateScrimMatch(client, 1, 0, { side: 'knife' }), ScrimMatchChangedError);
  await assert.rejects(discardScrimMatch(client, 1, 0), ScrimMatchChangedError);
  assert.equal(await claimScrimMatchStart(client, 1, 1), 2);
  await assert.rejects(claimScrimMatchStart(client, 1, 1), ScrimMatchChangedError);
  await discardScrimMatch(client, 1, 2);
  assert.equal(db.matches.length, 0);
  await assert.rejects(discardScrimMatch(client, 1, 2), ScrimMatchChangedError, 'a discarded match reads as changed');
});

test('updateScrimMatch / discardScrimMatch: a started match is refused as a conflict, not as changed', async () => {
  const db: FakeDb = {
    matches: [{ id: 1, scrim_night_id: 5, scrim_revision: 3, scrim_side_choice: 'knife', final_score: null }],
    player_match_stats: [],
    match_server_state: [{ match_id: 1, server_state: 'live' }],
  };
  const client = createFakeSupabaseClient(db, scrimMatchRpcs) as never;
  for (const write of [updateScrimMatch(client, 1, 3, { side: 'random' }), discardScrimMatch(client, 1, 3)]) {
    await assert.rejects(write, (err) => err instanceof ScrimMatchConflictError && !(err instanceof ScrimMatchChangedError));
  }
});

test('isScrimMatchEditable: open until scored or started; a failed start reopens it', () => {
  assert.equal(isScrimMatchEditable({ final_score: null, server_state: null }), true);
  assert.equal(isScrimMatchEditable({ final_score: null, server_state: 'failed' }), true);
  assert.equal(isScrimMatchEditable({ final_score: null, server_state: 'idle' }), true);
  for (const state of ['provisioning', 'live', 'tearing_down', 'done']) {
    assert.equal(isScrimMatchEditable({ final_score: null, server_state: state }), false, state);
  }
  assert.equal(isScrimMatchEditable({ final_score: '13-9', server_state: null }), false);
});

test('isScrimMatchDiscardable: until scored, unless it holds the server; a stopped, unscored match can go', () => {
  for (const state of [null, 'idle', 'failed', 'done']) {
    assert.equal(isScrimMatchDiscardable({ final_score: null, server_state: state }), true, String(state));
  }
  for (const state of ['provisioning', 'live', 'tearing_down']) {
    assert.equal(isScrimMatchDiscardable({ final_score: null, server_state: state }), false, state);
  }
  assert.equal(isScrimMatchDiscardable({ final_score: '13-9', server_state: 'done' }), false);
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

test('applyScrimSideChoice: a random side already flipped is kept; a new choice clears it for the next start', async () => {
  const db: FakeDb = { matches: [{ id: 1, scrim_night_id: 5, scrim_side_choice: 'random', skins_starting_side: null, final_score: null }], match_server_state: [] };
  const client = createFakeSupabaseClient(db, scrimMatchRpcs) as never;
  await applyScrimSideChoice(client, 1, () => 0.1);
  await applyScrimSideChoice(client, 1, () => 0.9);
  assert.equal(db.matches[0].skins_starting_side, 'T', 'starting again does not re-flip');
  await updateScrimMatch(client, 1, 0, { side: 'random' });
  assert.equal(db.matches[0].skins_starting_side, null);
  await applyScrimSideChoice(client, 1, () => 0.9);
  assert.equal(db.matches[0].skins_starting_side, 'CT');
});

test('resolveScrimMap: a known map keeps its name; any other item is named by Steam, or by its id when Steam is down; null for an item Steam does not know', async () => {
  const known = [{ name: 'Foroglio', workshopId: '111' }];
  assert.deepEqual(await resolveScrimMap('111', known, async () => null), { name: 'Foroglio', workshopId: '111' });
  assert.deepEqual(await resolveScrimMap('999', known, async () => ({ title: 'Dust Wingman', previewUrl: null })), { name: 'Dust Wingman', workshopId: '999' });
  assert.deepEqual(await resolveScrimMap('999', known, async () => { throw new Error('down'); }), { name: 'Workshop 999', workshopId: '999' });
  assert.equal(await resolveScrimMap('999', known, async () => null), null);
});

test('parseScrimTeams: two distinct positive ids per side', () => {
  assert.deepEqual(parseScrimTeams({ shirts: [1, 2], skins: [3, 4] }), { shirts: [1, 2], skins: [3, 4] });
  assert.equal(parseScrimTeams({ shirts: [1, 1], skins: [3, 4] }), null);
  assert.equal(parseScrimTeams({ shirts: [1, 2], skins: [3] }), null);
  assert.equal(parseScrimTeams({ shirts: [1, 2], skins: [3, 0] }), null);
  assert.equal(parseScrimTeams(null), null);
});

test('leagueMatchBlockingScrim: a league match within 30 minutes either side holds the server; one further off does not', () => {
  const now = new Date('2026-11-05T20:00:00Z');
  const at = (minutes: number) => ({ id: minutes, label: `League ${minutes}`, scheduledAt: new Date(now.getTime() + minutes * 60_000).toISOString() });
  assert.equal(leagueMatchBlockingScrim([at(20)], now)?.id, 20);
  assert.equal(leagueMatchBlockingScrim([at(-20)], now)?.id, -20, 'one that started a moment ago is still being played');
  assert.equal(leagueMatchBlockingScrim([at(30)], now), null, 'exactly 30 minutes out is clear');
  assert.equal(leagueMatchBlockingScrim([at(45), at(-40)], now), null);
  assert.equal(leagueMatchBlockingScrim([at(25), at(10)], now)?.id, 10, 'the nearest one');
});

test('scrimMatchPlaysAfter: waits behind the night\'s first match still needing the server', () => {
  const m = (id: number, final_score: string | null, server_state: string | null) => ({ id, match_number: id, final_score, server_state });
  const night = [m(1, '13-9', 'done'), m(2, null, 'tearing_down'), m(3, null, 'live'), m(4, null, null)];
  assert.equal(scrimMatchPlaysAfter(night, 4), 3);
  assert.equal(scrimMatchPlaysAfter(night, 3), null, 'next up');
  assert.equal(scrimMatchPlaysAfter(night, 99), null, 'not on this night');
});

report();
