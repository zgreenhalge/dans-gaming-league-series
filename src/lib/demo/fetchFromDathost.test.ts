/**
 * Unit test for `isPollTimeout()` — the predicate `waitForConcurrentPull()` uses to distinguish
 * `pollUntil`'s own deadline-exceeded signal (safe to swallow, fall back to pulling from DatHost)
 * from a real R2 read failure (must propagate, not be silently masked as a normal cache miss).
 *
 * Run:  npx tsx src/lib/demo/fetchFromDathost.test.ts
 */

import assert from 'node:assert/strict';
import { isPollTimeout } from './fetchFromDathost';
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

report();
