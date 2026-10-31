/**
 * Scrim night scheduling: timezone conversion (including both DST transitions), expanding the weekly
 * slot into concrete nights merged with `scrim_nights` rows, and request-body parsing.
 *
 * Run:  npx vitest run src/lib/scrim-schedule.test.ts
 */

import assert from 'node:assert/strict';
import { test, report } from './test-support/miniTest';
import {
  zonedTimeToUtc,
  dateInZone,
  isNightDate,
  scrimNightSlots,
  nextScrimNight,
  hasScrimNightStarted,
  parseScrimScheduleInput,
  parseCommitment,
  normalizeStartTime,
  formatStartTime,
  formatNightDate,
  SCRIM_NIGHT_LENGTH_MS,
  type ScrimSchedule,
} from './scrim-schedule';

const NY = 'America/New_York';
/** Thursdays at 8pm Eastern. */
const THURSDAY_8PM: ScrimSchedule = { weekday: 4, startTime: '20:00', timezone: NY, enabled: true };

test('zonedTimeToUtc: applies standard and daylight offsets', () => {
  assert.equal(zonedTimeToUtc('2026-01-15', '20:00', NY).toISOString(), '2026-01-16T01:00:00.000Z');
  assert.equal(zonedTimeToUtc('2026-07-15', '20:00', NY).toISOString(), '2026-07-16T00:00:00.000Z');
});

test('zonedTimeToUtc: lands on the right side of both DST transitions', () => {
  // US DST 2026: starts Sun Mar 8, ends Sun Nov 1 (both at 2am local).
  assert.equal(zonedTimeToUtc('2026-03-08', '20:00', NY).toISOString(), '2026-03-09T00:00:00.000Z');
  assert.equal(zonedTimeToUtc('2026-03-07', '20:00', NY).toISOString(), '2026-03-08T01:00:00.000Z');
  assert.equal(zonedTimeToUtc('2026-11-01', '20:00', NY).toISOString(), '2026-11-02T01:00:00.000Z');
  assert.equal(zonedTimeToUtc('2026-10-31', '20:00', NY).toISOString(), '2026-11-01T00:00:00.000Z');
});

test('zonedTimeToUtc: UTC is a passthrough', () => {
  assert.equal(zonedTimeToUtc('2026-05-05', '09:30', 'UTC').toISOString(), '2026-05-05T09:30:00.000Z');
});

test('dateInZone: the local date, not the UTC one', () => {
  // 02:00 UTC on the 16th is still the evening of the 15th in New York.
  assert.equal(dateInZone(new Date('2026-01-16T02:00:00Z'), NY), '2026-01-15');
  assert.equal(dateInZone(new Date('2026-01-16T02:00:00Z'), 'UTC'), '2026-01-16');
});

test('isNightDate: accepts real dates only', () => {
  assert.equal(isNightDate('2026-11-05'), true);
  assert.equal(isNightDate('2026-02-30'), false);
  assert.equal(isNightDate('2026-11-5'), false);
  assert.equal(isNightDate('not-a-date'), false);
});

test('normalizeStartTime: trims Postgres seconds', () => {
  assert.equal(normalizeStartTime('20:00:00'), '20:00');
  assert.equal(normalizeStartTime('20:00'), '20:00');
});

test('formatStartTime / formatNightDate: fixed, locale-free labels', () => {
  assert.equal(formatStartTime('20:00'), '8:00 PM');
  assert.equal(formatStartTime('00:05'), '12:05 AM');
  assert.equal(formatStartTime('12:30'), '12:30 PM');
  assert.equal(formatNightDate('2026-11-05'), 'Thu, Nov 5');
});

test('scrimNightSlots: no schedule or a disabled one lists nothing', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  assert.deepEqual(scrimNightSlots(null, [], now), []);
  assert.deepEqual(scrimNightSlots({ ...THURSDAY_8PM, enabled: false }, [{ id: 1, night_date: '2026-11-05', cancelled: false }], now), []);
});

test('scrimNightSlots: the next weekly dates, soonest first', () => {
  const now = new Date('2026-11-02T12:00:00Z'); // Monday
  const slots = scrimNightSlots(THURSDAY_8PM, [], now, 3);
  assert.deepEqual(slots.map((s) => s.date), ['2026-11-05', '2026-11-12', '2026-11-19']);
  assert.equal(slots[0].startsAt, '2026-11-06T01:00:00.000Z');
  assert.ok(slots.every((s) => s.nightId === null && !s.cancelled));
});

test('scrimNightSlots: a night stays listed until SCRIM_NIGHT_LENGTH_MS after it starts', () => {
  const start = Date.parse('2026-11-06T01:00:00Z');
  const during = scrimNightSlots(THURSDAY_8PM, [], new Date(start + SCRIM_NIGHT_LENGTH_MS - 1), 2);
  assert.equal(during[0].date, '2026-11-05');
  assert.equal(hasScrimNightStarted(during[0], new Date(start + 1)), true);
  const after = scrimNightSlots(THURSDAY_8PM, [], new Date(start + SCRIM_NIGHT_LENGTH_MS), 2);
  assert.equal(after[0].date, '2026-11-12');
});

test('scrimNightSlots: a late night still running after local midnight stays current', () => {
  const lateNight: ScrimSchedule = { ...THURSDAY_8PM, startTime: '23:00' };
  // 00:30 Friday local — the Thursday 11pm night is 90 minutes in.
  const now = zonedTimeToUtc('2026-11-06', '00:30', NY);
  const slots = scrimNightSlots(lateNight, [], now, 1);
  assert.equal(slots[0].date, '2026-11-05');
});

test('scrimNightSlots: merges night rows, and keeps an off-schedule row that is still ahead', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  const slots = scrimNightSlots(
    THURSDAY_8PM,
    [
      { id: 7, night_date: '2026-11-05', cancelled: true },
      { id: 8, night_date: '2026-11-04', cancelled: false }, // a Wednesday from an earlier schedule
      { id: 9, night_date: '2026-10-29', cancelled: false }, // ended
    ],
    now,
    2,
  );
  assert.deepEqual(
    slots.map((s) => [s.date, s.nightId, s.cancelled]),
    [
      ['2026-11-04', 8, false],
      ['2026-11-05', 7, true],
      ['2026-11-12', null, false],
    ],
  );
});

test('nextScrimNight: skips cancelled nights', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  const slots = scrimNightSlots(THURSDAY_8PM, [{ id: 7, night_date: '2026-11-05', cancelled: true }], now, 2);
  assert.equal(nextScrimNight(slots)?.date, '2026-11-12');
  assert.equal(nextScrimNight([]), null);
});

test('parseScrimScheduleInput: accepts a valid body and names the first bad field', () => {
  assert.deepEqual(parseScrimScheduleInput({ weekday: 4, startTime: '20:00', timezone: NY, enabled: true }), {
    ok: true,
    schedule: THURSDAY_8PM,
  });
  const bad = (body: unknown) => {
    const r = parseScrimScheduleInput(body);
    return r.ok ? null : r.error;
  };
  assert.match(bad({ weekday: 7, startTime: '20:00', timezone: NY, enabled: true }) ?? '', /weekday/);
  assert.match(bad({ weekday: 4, startTime: '8pm', timezone: NY, enabled: true }) ?? '', /startTime/);
  assert.match(bad({ weekday: 4, startTime: '24:00', timezone: NY, enabled: true }) ?? '', /startTime/);
  assert.match(bad({ weekday: 4, startTime: '20:00', timezone: 'Mars/Olympus', enabled: true }) ?? '', /timezone/);
  assert.match(bad({ weekday: 4, startTime: '20:00', timezone: NY }) ?? '', /enabled/);
  assert.match(bad(null) ?? '', /weekday/);
});

test('parseCommitment: only definite or maybe', () => {
  assert.equal(parseCommitment('definite'), 'definite');
  assert.equal(parseCommitment('maybe'), 'maybe');
  assert.equal(parseCommitment('yes'), null);
  assert.equal(parseCommitment(undefined), null);
});

report();
