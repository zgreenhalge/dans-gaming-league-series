/**
 * Month calendar grid: Sunday-first weeks with padding, local day keys, and month arithmetic across
 * year boundaries.
 *
 * Run:  npx vitest run src/lib/calendar-month.test.ts
 */

import assert from 'node:assert/strict';
import { test, report } from './test-support/miniTest';
import { addMonths, localDayKey, monthGrid } from './calendar-month';

test('localDayKey: the local calendar day, zero-padded', () => {
  assert.equal(localDayKey(new Date(2026, 0, 5, 23, 30)), '2026-01-05');
});

test('monthGrid: Sunday-first weeks, padded with null', () => {
  // November 2026 starts on a Sunday and has 30 days: five weeks, the last ending in nulls.
  const nov = monthGrid(2026, 10);
  assert.equal(nov.length, 5);
  assert.equal(nov[0][0], '2026-11-01');
  assert.deepEqual(nov[4], ['2026-11-29', '2026-11-30', null, null, null, null, null]);
  // February 2026 starts on a Sunday and has 28 days: exactly four weeks.
  assert.equal(monthGrid(2026, 1).length, 4);
  // October 2026 starts on a Thursday.
  assert.deepEqual(monthGrid(2026, 9)[0].slice(0, 5), [null, null, null, null, '2026-10-01']);
});

test('addMonths: wraps across years', () => {
  assert.deepEqual(addMonths({ year: 2026, month: 11 }, 1), { year: 2027, month: 0 });
  assert.deepEqual(addMonths({ year: 2026, month: 0 }, -1), { year: 2025, month: 11 });
});

report();
