/**
 * Who may reopen a scrim night, and why not: `scrimNightReopenRefusal()` / `canViewerReopenScrimNight()` —
 * the one rule the night page's Reopen button is offered on and `requireScrimNightReopenAccess()`
 * enforces — and `isSignedUpForNight()`, the signed-up check End night and Reopen share.
 *
 * Run:  npx vitest run src/lib/scrim-reopen-night.test.ts
 */

import assert from 'node:assert/strict';
import { test, report } from './test-support/miniTest';
import { canViewerReopenScrimNight, isSignedUpForNight, scrimNightReopenRefusal } from './scrim-matches';
import type { ScrimNight } from './scrim-schedule';

const NIGHT: ScrimNight = { id: 5, startsAt: '2026-01-01T20:00:00Z', endedAt: '2026-01-01T20:10:00Z' };
const ON: ScrimNight = { id: 5, startsAt: '2026-01-01T20:00:00Z' };
const AFTER_END = new Date('2026-01-01T21:00:00Z');
const DURING = new Date('2026-01-01T20:30:00Z');
const TOO_LATE = new Date('2026-01-02T08:00:00Z');
const SIGNUPS = [{ player_id: 1 }, { player_id: 2 }];
const PLAYER = (playerId: number | null) => ({ playerId, isAdmin: false });
const ADMIN = { playerId: 9, isAdmin: true };

test('isSignedUpForNight: a listed player, never a signed-out viewer', () => {
  assert.equal(isSignedUpForNight(SIGNUPS, 1), true);
  assert.equal(isSignedUpForNight(SIGNUPS, 7), false);
  assert.equal(isSignedUpForNight(SIGNUPS, null), false);
});

test('a signed-up player or an admin may reopen a night that is over and within its span', () => {
  assert.equal(scrimNightReopenRefusal(NIGHT, SIGNUPS, PLAYER(1), AFTER_END), null);
  assert.equal(canViewerReopenScrimNight(NIGHT, SIGNUPS, PLAYER(2), AFTER_END), true);
  assert.equal(canViewerReopenScrimNight(NIGHT, [], ADMIN, AFTER_END), true, 'an admin need not be signed up');
});

test('anyone else is refused with a 403, before the night is checked', () => {
  const refusal = { status: 403, error: 'Only players on the night can reopen it' };
  assert.deepEqual(scrimNightReopenRefusal(NIGHT, SIGNUPS, PLAYER(7), AFTER_END), refusal);
  assert.deepEqual(scrimNightReopenRefusal(NIGHT, SIGNUPS, PLAYER(null), AFTER_END), refusal);
  assert.deepEqual(scrimNightReopenRefusal(ON, SIGNUPS, PLAYER(7), DURING), refusal);
});

test('a night still on, or past its span, is a 409', () => {
  assert.deepEqual(scrimNightReopenRefusal(ON, SIGNUPS, ADMIN, DURING), { status: 409, error: 'That night is still on' });
  assert.deepEqual(scrimNightReopenRefusal(NIGHT, SIGNUPS, ADMIN, TOO_LATE), { status: 409, error: 'That night is too long ago to reopen' });
  assert.equal(canViewerReopenScrimNight(ON, SIGNUPS, PLAYER(1), DURING), false);
});

report();
