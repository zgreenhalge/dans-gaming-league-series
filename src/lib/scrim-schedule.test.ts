/**
 * Scrim night timing: when a night has started and ended, the check-in window, the upcoming-nights
 * list, and request-body parsing.
 *
 * Run:  npx vitest run src/lib/scrim-schedule.test.ts
 */

import assert from 'node:assert/strict';
import { test, report } from './test-support/miniTest';
import {
  hasScrimNightEnded,
  hasScrimNightStarted,
  isScrimCheckInOpen,
  leagueMatchesDuring,
  parseCommitment,
  scrimNightBoundaries,
  scrimNightEnd,
  SCRIM_LEAGUE_CLEARANCE_MS,
  parseNightStart,
  upcomingScrimNights,
  SCRIM_CHECK_IN_LEAD_MS,
  SCRIM_MAX_DAYS_AHEAD,
  SCRIM_START_STEP_MINUTES,
  SCRIM_NIGHT_IDLE_MS,
  SCRIM_NIGHT_SPAN_MS,
  canReopenScrimNight,
} from './scrim-schedule';
import { readMigration, migrationFiles } from './test-support/migrationSql';

const START = '2026-11-06T01:00:00.000Z'; // Thu Nov 5, 8pm Eastern
const NIGHT = { id: 1, startsAt: START };
const HOUR = 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(Date.parse(START) + offsetMs);

test('hasScrimNightStarted / hasScrimNightEnded: a night with nothing done on it ends SCRIM_NIGHT_IDLE_MS after its start', () => {
  assert.equal(hasScrimNightStarted(NIGHT, at(-1)), false);
  assert.equal(hasScrimNightStarted(NIGHT, at(0)), true);
  assert.equal(hasScrimNightEnded(NIGHT, at(SCRIM_NIGHT_IDLE_MS - 1)), false);
  assert.equal(hasScrimNightEnded(NIGHT, at(SCRIM_NIGHT_IDLE_MS)), true);
});

test('hasScrimNightEnded: activity keeps a night going until SCRIM_NIGHT_IDLE_MS after the latest, with no clock end', () => {
  const active = { ...NIGHT, lastActiveAt: at(6 * HOUR).toISOString() };
  assert.equal(hasScrimNightEnded(active, at(6 * HOUR + SCRIM_NIGHT_IDLE_MS - 1)), false);
  assert.equal(hasScrimNightEnded(active, at(6 * HOUR + SCRIM_NIGHT_IDLE_MS)), true);
  // Activity before the start (a check-in in the lead window) counts from the start.
  const early = { ...NIGHT, lastActiveAt: at(-10 * 60_000).toISOString() };
  assert.equal(scrimNightEnd(early), Date.parse(START) + SCRIM_NIGHT_IDLE_MS);
});

test('hasScrimNightEnded: a night ended by hand is over at once, and closes check-in', () => {
  const ended = { ...NIGHT, endedAt: at(60_000).toISOString() };
  assert.equal(hasScrimNightEnded(ended, at(60_000)), true);
  assert.equal(isScrimCheckInOpen(ended, at(60_000)), false);
  assert.equal(hasScrimNightEnded({ ...NIGHT, endedAt: null }, at(60_000)), false);
});

test('isScrimCheckInOpen: from SCRIM_CHECK_IN_LEAD_MS before the start until the night ends', () => {
  assert.equal(isScrimCheckInOpen(NIGHT, at(-SCRIM_CHECK_IN_LEAD_MS - 1)), false);
  assert.equal(isScrimCheckInOpen(NIGHT, at(-SCRIM_CHECK_IN_LEAD_MS)), true);
  assert.equal(isScrimCheckInOpen(NIGHT, at(SCRIM_NIGHT_IDLE_MS - 1)), true);
  assert.equal(isScrimCheckInOpen(NIGHT, at(SCRIM_NIGHT_IDLE_MS)), false);
});

test('scrimNightBoundaries: each instant is exactly where its clock check flips', () => {
  const [checkIn, start, end, reopenEnds] = scrimNightBoundaries(NIGHT);
  const before = (t: number) => new Date(t - 1);
  assert.equal(isScrimCheckInOpen(NIGHT, before(checkIn)), false);
  assert.equal(isScrimCheckInOpen(NIGHT, new Date(checkIn)), true);
  assert.equal(hasScrimNightStarted(NIGHT, before(start)), false);
  assert.equal(hasScrimNightStarted(NIGHT, new Date(start)), true);
  assert.equal(hasScrimNightEnded(NIGHT, before(end)), false);
  assert.equal(hasScrimNightEnded(NIGHT, new Date(end)), true);
  assert.equal(canReopenScrimNight(NIGHT, before(reopenEnds)), true);
  assert.equal(canReopenScrimNight(NIGHT, new Date(reopenEnds)), false);
  // A night ended by hand ends at that instant, so nothing is left to refresh for afterward.
  const ended = { ...NIGHT, endedAt: at(HOUR).toISOString() };
  assert.equal(scrimNightBoundaries(ended)[2], at(HOUR).getTime());
});

test('upcomingScrimNights: drops ended nights, soonest first', () => {
  const nights = [
    { id: 3, startsAt: '2026-11-13T01:00:00.000Z' },
    { id: 2, startsAt: START },
    { id: 1, startsAt: '2026-10-30T00:00:00.000Z' },
  ];
  assert.deepEqual(upcomingScrimNights(nights, at(60_000)).map((n) => n.id), [2, 3]);
});

test('parseNightStart: a quarter-hour instant that has not already ended, within SCRIM_MAX_DAYS_AHEAD', () => {
  const now = at(0);
  const quarter = SCRIM_START_STEP_MINUTES * 60_000;
  assert.deepEqual(parseNightStart('2026-11-06T02:30:00Z', now), { ok: true, startsAt: '2026-11-06T02:30:00.000Z' });
  assert.equal(parseNightStart(new Date(now.getTime() - SCRIM_NIGHT_IDLE_MS + quarter).toISOString(), now).ok, true);
  assert.equal(parseNightStart(new Date(now.getTime() - SCRIM_NIGHT_IDLE_MS).toISOString(), now).ok, false);
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

test('leagueMatchesDuring: league matches from the clearance before the start through SCRIM_NIGHT_SPAN_MS after, soonest first', () => {
  const at = (offsetMs: number, id: number) => ({ id, label: `M${id}`, scheduledAt: at0(offsetMs) });
  const at0 = (offsetMs: number) => new Date(Date.parse(START) + offsetMs).toISOString();
  const matches = [
    at(2 * 60 * 60 * 1000, 2),
    at(-SCRIM_LEAGUE_CLEARANCE_MS, 1),
    at(-SCRIM_LEAGUE_CLEARANCE_MS - 60_000, 0),
    at(SCRIM_NIGHT_SPAN_MS, 3),
  ];
  assert.deepEqual(leagueMatchesDuring(NIGHT, matches).map((m) => m.id), [1, 2]);
});

test('scrimNightEnd: endedAt when set (never before the start), else idle after the latest activity', () => {
  assert.equal(scrimNightEnd(NIGHT), Date.parse(START) + SCRIM_NIGHT_IDLE_MS);
  const ended = at(5 * HOUR).toISOString();
  assert.equal(scrimNightEnd({ ...NIGHT, endedAt: ended, lastActiveAt: at(6 * HOUR).toISOString() }), Date.parse(ended));
  assert.equal(scrimNightEnd({ ...NIGHT, endedAt: at(-HOUR).toISOString() }), Date.parse(START));
});

test('canReopenScrimNight: once over, until SCRIM_NIGHT_SPAN_MS after the start', () => {
  const ended = { ...NIGHT, endedAt: at(HOUR).toISOString() };
  assert.equal(canReopenScrimNight(ended, at(HOUR)), true);
  assert.equal(canReopenScrimNight(ended, at(SCRIM_NIGHT_SPAN_MS - 1)), true);
  assert.equal(canReopenScrimNight(ended, at(SCRIM_NIGHT_SPAN_MS)), false);
  assert.equal(canReopenScrimNight(NIGHT, at(SCRIM_NIGHT_IDLE_MS)), true, 'gone idle');
  assert.equal(canReopenScrimNight(NIGHT, at(SCRIM_NIGHT_IDLE_MS - 1)), false, 'still on');
});

test("SCRIM_NIGHT_IDLE_MS matches the idle interval in the latest migration's scrim_night_end()", () => {
  const sql = migrationFiles().map(readMigration).filter((s) => /function public\.scrim_night_end\(/.test(s)).at(-1) ?? '';
  const minutes = Number(/\+ interval '(\d+) minutes'/.exec(sql)?.[1]);
  assert.equal(minutes * 60_000, SCRIM_NIGHT_IDLE_MS);
});

test('only a match starting or being scored stamps a scrim night as active', () => {
  const sql = migrationFiles().map(readMigration).filter((s) => /function public\.touch_scrim_night_on_activity\(/.test(s)).at(-1) ?? '';
  const triggers = [...sql.matchAll(/create trigger (touch_scrim_night_on_\w+) after [^\n]* on public\.(\w+)/g)].map((m) => `${m[2]}:${m[1]}`).sort();
  assert.deepEqual(triggers, [
    'live_match_score:touch_scrim_night_on_live_score',
    'match_server_state:touch_scrim_night_on_server_start',
    'match_server_state:touch_scrim_night_on_server_state',
    'matches:touch_scrim_night_on_score',
  ]);
  // A server counts as starting once it is provisioning or live; no other state is activity.
  for (const name of ['touch_scrim_night_on_server_start', 'touch_scrim_night_on_server_state']) {
    const block = new RegExp(`create trigger ${name}[\\s\\S]*?;`).exec(sql)?.[0] ?? '';
    assert.match(block, /server_state in \('provisioning', 'live'\)/, name);
  }
});

report();
