/**
 * Who may end a scrim night, and why not: `scrimNightEndRefusal()` / `canEndScrimNight()` — the one rule
 * the night page's End night button is offered on and `requireScrimNightEndAccess()` enforces. The
 * refusal carries the route's status and message, in the order the route checks them.
 *
 * Run:  npx vitest run src/lib/scrim-end-night.test.ts
 */

import assert from 'node:assert/strict';
import { test, report } from './test-support/miniTest';
import { canEndScrimNight, scrimNightEndRefusal } from './scrim-matches';
import { SCRIM_NIGHT_OVER_ERROR, type ScrimNight } from './scrim-schedule';

const NIGHT: ScrimNight = { id: 5, startsAt: '2026-01-01T20:00:00Z' };
const DURING = new Date('2026-01-01T20:30:00Z');
const BEFORE = new Date('2026-01-01T19:00:00Z');
const IDLE = new Date('2026-01-01T22:00:00Z');
const SIGNUPS = [{ player_id: 1 }, { player_id: 2 }];
const PLAYER = (playerId: number | null) => ({ playerId, isAdmin: false });
const ADMIN = { playerId: 9, isAdmin: true };
const WAITING = { final_score: null, server_state: null };
const ON_SERVER = { final_score: null, server_state: 'live' };
const GAME_OVER = { final_score: null, server_state: 'done' };
const SCORED = { final_score: '13-9', server_state: 'done' };

test('a signed-up player or an admin may end a night that is running with nothing waiting', () => {
  assert.equal(scrimNightEndRefusal(NIGHT, SIGNUPS, [], PLAYER(1), DURING), null);
  assert.equal(scrimNightEndRefusal(NIGHT, SIGNUPS, [SCORED, GAME_OVER], ADMIN, DURING), null, 'finished games do not hold it');
  assert.equal(canEndScrimNight(NIGHT, SIGNUPS, [], PLAYER(2), DURING), true);
  assert.equal(canEndScrimNight(NIGHT, [], [], ADMIN, DURING), true, 'an admin need not be signed up');
});

test('refused before the night starts, 409', () => {
  assert.deepEqual(scrimNightEndRefusal(NIGHT, SIGNUPS, [], PLAYER(1), BEFORE), { status: 409, error: 'That night has not started yet' });
});

test('refused once the night is over, by hand or by going idle, 409', () => {
  const over = { status: 409, error: SCRIM_NIGHT_OVER_ERROR };
  assert.deepEqual(scrimNightEndRefusal({ ...NIGHT, endedAt: '2026-01-01T20:10:00Z' }, SIGNUPS, [], ADMIN, DURING), over);
  assert.deepEqual(scrimNightEndRefusal(NIGHT, SIGNUPS, [], ADMIN, IDLE), over);
});

test('refused for a viewer who is neither signed up nor an admin, 403, including signed out', () => {
  const refusal = { status: 403, error: 'Only players on the night can end it' };
  assert.deepEqual(scrimNightEndRefusal(NIGHT, SIGNUPS, [], PLAYER(7), DURING), refusal);
  assert.deepEqual(scrimNightEndRefusal(NIGHT, SIGNUPS, [], PLAYER(null), DURING), refusal);
});

test('refused while a match still needs the server, 409 — waiting to start or on the server', () => {
  const refusal = { status: 409, error: "Finish or discard the night's waiting matches first" };
  assert.deepEqual(scrimNightEndRefusal(NIGHT, SIGNUPS, [WAITING], PLAYER(1), DURING), refusal);
  assert.deepEqual(scrimNightEndRefusal(NIGHT, SIGNUPS, [SCORED, ON_SERVER], ADMIN, DURING), refusal);
});

test('checks run in the route\'s order: over, not started, not on the night, then a waiting match', () => {
  assert.equal(scrimNightEndRefusal(NIGHT, SIGNUPS, [WAITING], PLAYER(7), BEFORE)?.error, 'That night has not started yet');
  assert.equal(scrimNightEndRefusal(NIGHT, SIGNUPS, [WAITING], PLAYER(7), DURING)?.status, 403);
  assert.equal(scrimNightEndRefusal(NIGHT, SIGNUPS, [WAITING], PLAYER(7), IDLE)?.error, SCRIM_NIGHT_OVER_ERROR);
});

report();
