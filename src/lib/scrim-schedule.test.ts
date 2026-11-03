/**
 * Scrim night timing: when a night has started and ended, the check-in window, the upcoming-nights
 * list, the server-side date label, and request-body parsing.
 *
 * Run:  npx vitest run src/lib/scrim-schedule.test.ts
 */

import assert from 'node:assert/strict';
import { test, report } from './test-support/miniTest';
import {
  formatNightDate,
  formatNightStart,
  hasScrimNightEnded,
  hasScrimNightStarted,
  isScrimCheckInOpen,
  leagueMatchesDuring,
  parseCommitment,
  SCRIM_LEAGUE_CLEARANCE_MS,
  parseNightStart,
  upcomingScrimNights,
  SCRIM_CHECK_IN_LEAD_MS,
  SCRIM_MAX_DAYS_AHEAD,
  SCRIM_START_STEP_MINUTES,
  SCRIM_NIGHT_LENGTH_MS,
} from './scrim-schedule';

const START = '2026-11-06T01:00:00.000Z'; // Thu Nov 5, 8pm Eastern
const NIGHT = { id: 1, startsAt: START };
const at = (offsetMs: number) => new Date(Date.parse(START) + offsetMs);

test('hasScrimNightStarted / hasScrimNightEnded: the night runs SCRIM_NIGHT_LENGTH_MS from its start', () => {
  assert.equal(hasScrimNightStarted(NIGHT, at(-1)), false);
  assert.equal(hasScrimNightStarted(NIGHT, at(0)), true);
  assert.equal(hasScrimNightEnded(NIGHT, at(SCRIM_NIGHT_LENGTH_MS - 1)), false);
  assert.equal(hasScrimNightEnded(NIGHT, at(SCRIM_NIGHT_LENGTH_MS)), true);
});

test('isScrimCheckInOpen: from SCRIM_CHECK_IN_LEAD_MS before the start until the night ends', () => {
  assert.equal(isScrimCheckInOpen(NIGHT, at(-SCRIM_CHECK_IN_LEAD_MS - 1)), false);
  assert.equal(isScrimCheckInOpen(NIGHT, at(-SCRIM_CHECK_IN_LEAD_MS)), true);
  assert.equal(isScrimCheckInOpen(NIGHT, at(SCRIM_NIGHT_LENGTH_MS - 1)), true);
  assert.equal(isScrimCheckInOpen(NIGHT, at(SCRIM_NIGHT_LENGTH_MS)), false);
});

test('upcomingScrimNights: drops ended nights, soonest first', () => {
  const nights = [
    { id: 3, startsAt: '2026-11-13T01:00:00.000Z' },
    { id: 2, startsAt: START },
    { id: 1, startsAt: '2026-10-30T00:00:00.000Z' },
  ];
  assert.deepEqual(upcomingScrimNights(nights, at(60_000)).map((n) => n.id), [2, 3]);
});

test('formatNightDate: the date in the league timezone, not UTC', () => {
  assert.equal(formatNightDate(START), 'Thu, Nov 5');
});

test('formatNightStart: date and time in the league timezone, labelled ET', () => {
  assert.equal(formatNightStart(START), 'Thu, Nov 5, 8:00 PM ET');
});

test('parseNightStart: a quarter-hour instant that has not already ended, within SCRIM_MAX_DAYS_AHEAD', () => {
  const now = at(0);
  const quarter = SCRIM_START_STEP_MINUTES * 60_000;
  assert.deepEqual(parseNightStart('2026-11-06T02:30:00Z', now), { ok: true, startsAt: '2026-11-06T02:30:00.000Z' });
  assert.equal(parseNightStart(new Date(now.getTime() - SCRIM_NIGHT_LENGTH_MS + quarter).toISOString(), now).ok, true);
  assert.equal(parseNightStart(new Date(now.getTime() - SCRIM_NIGHT_LENGTH_MS).toISOString(), now).ok, false);
  const day = 24 * 60 * 60 * 1000;
  assert.equal(parseNightStart(new Date(now.getTime() + SCRIM_MAX_DAYS_AHEAD * day).toISOString(), now).ok, true);
  assert.equal(parseNightStart(new Date(now.getTime() + SCRIM_MAX_DAYS_AHEAD * day + quarter).toISOString(), now).ok, false);
  assert.equal(parseNightStart('2026-11-06T02:40:00Z', now).ok, false, 'not on a quarter hour');
  assert.equal(parseNightStart('2026-11-06T02:45:30Z', now).ok, false, 'seconds off the mark');
  assert.equal(parseNightStart('next thursday', now).ok, false);
  assert.equal(parseNightStart(12, now).ok, false);
});

test('parseCommitment: definite or maybe only', () => {
  assert.equal(parseCommitment('definite'), 'definite');
  assert.equal(parseCommitment('maybe'), 'maybe');
  assert.equal(parseCommitment('yes'), null);
});

test('leagueMatchesDuring: league matches from the clearance before the start until the night ends, soonest first', () => {
  const at = (offsetMs: number, id: number) => ({ id, label: `M${id}`, scheduledAt: at0(offsetMs) });
  const at0 = (offsetMs: number) => new Date(Date.parse(START) + offsetMs).toISOString();
  const matches = [
    at(2 * 60 * 60 * 1000, 2),
    at(-SCRIM_LEAGUE_CLEARANCE_MS, 1),
    at(-SCRIM_LEAGUE_CLEARANCE_MS - 60_000, 0),
    at(SCRIM_NIGHT_LENGTH_MS, 3),
  ];
  assert.deepEqual(leagueMatchesDuring(NIGHT, matches).map((m) => m.id), [1, 2]);
});

report();
