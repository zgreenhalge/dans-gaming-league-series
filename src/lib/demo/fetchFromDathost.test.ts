/**
 * Unit tests for `isPollTimeout()` — the predicate `waitForConcurrentPull()` uses to distinguish
 * `pollUntil`'s own deadline-exceeded signal (safe to swallow, fall back to pulling from DatHost)
 * from a real R2 read failure (must propagate, not be silently masked as a normal cache miss) — and
 * `remainingFlushFloorMs()` — how much of the post-`map_result` flush floor is still outstanding given
 * when `map_result` actually fired, the fact `ensureDemoInR2` now bases its wait on instead of trusting
 * a caller's "this dispatch was manual" assertion.
 *
 * Run:  npx tsx src/lib/demo/fetchFromDathost.test.ts
 */

import assert from 'node:assert/strict';
import { isPollTimeout, remainingFlushFloorMs, FLUSH_FLOOR_MS } from './fetchFromDathost';
import { DathostError } from '../dathost';
import { test, report } from '../test-support/miniTest';

test('isPollTimeout() — true for a pollUntil timeout', () => {
  assert.equal(isPollTimeout(new DathostError('demo not in R2 after waiting', 504, null)), true);
});

test('isPollTimeout() — false for a real R2 read failure', () => {
  assert.equal(isPollTimeout(new Error('AccessDenied: R2 credentials rejected')), false);
});

test('isPollTimeout() — false for a non-Error throw', () => {
  assert.equal(isPollTimeout('not an error at all'), false);
});

test('remainingFlushFloorMs() — null anchor (no job row yet) gets the full floor', () => {
  assert.equal(remainingFlushFloorMs(null), FLUSH_FLOOR_MS);
});

test('remainingFlushFloorMs() — map_result just now still needs (up to) the full floor', () => {
  const remaining = remainingFlushFloorMs(new Date());
  assert.ok(remaining > FLUSH_FLOOR_MS - 1000 && remaining <= FLUSH_FLOOR_MS, `expected ~${FLUSH_FLOOR_MS}, got ${remaining}`);
});

test('remainingFlushFloorMs() — map_result half the floor ago needs roughly the other half', () => {
  const halfAgo = new Date(Date.now() - FLUSH_FLOOR_MS / 2);
  const remaining = remainingFlushFloorMs(halfAgo);
  assert.ok(Math.abs(remaining - FLUSH_FLOOR_MS / 2) < 1000, `expected ~${FLUSH_FLOOR_MS / 2}, got ${remaining}`);
});

test('remainingFlushFloorMs() — map_result well past the floor is clamped to 0, not negative', () => {
  const daysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  assert.equal(remainingFlushFloorMs(daysAgo), 0);
});

test('remainingFlushFloorMs() — map_result exactly one floor-length ago is 0', () => {
  const exactlyFloorAgo = new Date(Date.now() - FLUSH_FLOOR_MS);
  assert.equal(remainingFlushFloorMs(exactlyFloorAgo), 0);
});

report();
