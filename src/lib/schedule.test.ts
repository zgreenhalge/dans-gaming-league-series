/**
 * Unit tests for findScheduleCollision — the shared-server collision boundary (#134). The window is
 * documented as strict (`<`, not `<=`) so matches exactly an hour apart do NOT collide; lock that
 * exact boundary down since it's the whole point of the function.
 *
 * Run:  npx tsx src/lib/schedule.test.ts
 */

import assert from 'node:assert/strict';
import { findScheduleCollision, SCHEDULE_COLLISION_WINDOW_MS, type ScheduledMatchRef } from './schedule';

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`${name}\n    ${(err as Error).message.replace(/\n/g, '\n    ')}`);
  }
}

function ref(id: number, iso: string): ScheduledMatchRef {
  return { id, scheduledAt: iso, label: `Match ${id}` };
}

const base = '2026-03-05T18:00:00.000Z';

test('findScheduleCollision: a match 30 minutes away collides', () => {
  const other = ref(1, '2026-03-05T18:30:00.000Z');
  assert.equal(findScheduleCollision(base, [other])?.id, 1);
});

test('findScheduleCollision: exactly 1 hour away does NOT collide (strict <)', () => {
  const other = ref(1, '2026-03-05T19:00:00.000Z');
  assert.equal(findScheduleCollision(base, [other]), null);
});

test('findScheduleCollision: 1 hour minus 1ms away DOES collide', () => {
  const other = ref(1, '2026-03-05T18:59:59.999Z');
  assert.equal(findScheduleCollision(base, [other])?.id, 1);
});

test('findScheduleCollision: picks the nearest of several colliding matches', () => {
  const far = ref(1, '2026-03-05T18:45:00.000Z'); // 45 min
  const near = ref(2, '2026-03-05T18:10:00.000Z'); // 10 min
  assert.equal(findScheduleCollision(base, [far, near])?.id, 2);
});

test('findScheduleCollision: null/empty input short-circuits to null', () => {
  assert.equal(findScheduleCollision(null, [ref(1, base)]), null);
  assert.equal(findScheduleCollision(base, []), null);
});

test('findScheduleCollision: an unparseable date on either side is skipped, not thrown', () => {
  assert.equal(findScheduleCollision('not a date', [ref(1, base)]), null);
  assert.equal(findScheduleCollision(base, [ref(1, 'not a date')]), null);
});

test('findScheduleCollision: a custom window overrides the 1-hour default', () => {
  const other = ref(1, '2026-03-05T18:20:00.000Z'); // 20 min away
  assert.equal(findScheduleCollision(base, [other], 15 * 60 * 1000), null); // 15-min window
  assert.equal(findScheduleCollision(base, [other], 30 * 60 * 1000)?.id, 1); // 30-min window
});

test('SCHEDULE_COLLISION_WINDOW_MS is exactly 1 hour', () => {
  assert.equal(SCHEDULE_COLLISION_WINDOW_MS, 60 * 60 * 1000);
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} failing, ${passed} passing\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${passed} passing`);
