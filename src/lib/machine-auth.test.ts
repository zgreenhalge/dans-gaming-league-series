/**
 * Covers `secretsMatch()` (equal secrets, unequal secrets, and a best-effort check that comparison
 * cost doesn't scale with the mismatch position — the observable symptom of a non-constant-time
 * compare) and `machineSecretGuard()`'s three outcomes (secret not configured, provided secret
 * doesn't match, provided secret matches).
 *
 * Run:  npx tsx src/lib/machine-auth.test.ts
 */

import assert from 'node:assert/strict';
import { test, report } from './test-support/miniTest';
import { secretsMatch, machineSecretGuard } from './machine-auth';

const SECRET = 'a'.repeat(64);

/** Mean wall-clock time, in nanoseconds, of `iterations` calls to `secretsMatch(provided, SECRET)`,
 * after a warmup pass to let the JIT settle. Used to compare the cost of a mismatch near the start
 * of the secret against one near the end — a non-constant-time compare (e.g. a loop that returns on
 * the first mismatched byte) would show a large gap; `timingSafeEqual` should not. */
function meanCompareTimeNs(provided: string, iterations: number): number {
  for (let i = 0; i < iterations; i++) secretsMatch(provided, SECRET);
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) secretsMatch(provided, SECRET);
  const end = process.hrtime.bigint();
  return Number(end - start) / iterations;
}

async function main() {
  await test('secretsMatch — equal secrets match', () => {
    assert.equal(secretsMatch(SECRET, SECRET), true);
  });

  await test('secretsMatch — unequal secrets of the same length do not match', () => {
    assert.equal(secretsMatch('b'.repeat(64), SECRET), false);
  });

  await test('secretsMatch — unequal secrets of different lengths do not match', () => {
    assert.equal(secretsMatch('short', SECRET), false);
  });

  await test('secretsMatch — a null provided secret does not match', () => {
    assert.equal(secretsMatch(null, SECRET), false);
  });

  await test('secretsMatch — mismatch position does not produce an order-of-magnitude timing gap', () => {
    const mismatchAtStart = 'b' + SECRET.slice(1);
    const mismatchAtEnd = SECRET.slice(0, -1) + 'b';
    // Warmup + a large iteration count keep this from being dominated by one-off JIT/GC noise;
    // the ratio bound is deliberately generous (a real O(n) short-circuit on a 64-byte secret would
    // produce a far larger gap than this) to keep the check meaningful without being flaky.
    const iterations = 20_000;
    meanCompareTimeNs(mismatchAtStart, iterations); // warmup
    const early = meanCompareTimeNs(mismatchAtStart, iterations);
    const late = meanCompareTimeNs(mismatchAtEnd, iterations);
    const ratio = Math.max(early, late) / Math.min(early, late);
    assert.ok(ratio < 5, `expected comparable timing regardless of mismatch position, got ratio ${ratio.toFixed(2)} (early=${early.toFixed(1)}ns, late=${late.toFixed(1)}ns)`);
  });

  await test('machineSecretGuard — missing configured secret fails closed (503)', async () => {
    const res = machineSecretGuard('anything', undefined, 'Machine secret not configured');
    assert.ok(res);
    assert.equal(res!.status, 503);
    assert.deepEqual(await res!.json(), { error: 'Machine secret not configured' });
  });

  await test('machineSecretGuard — missing provided secret is rejected (401)', async () => {
    const res = machineSecretGuard(null, SECRET, 'Machine secret not configured');
    assert.ok(res);
    assert.equal(res!.status, 401);
    assert.deepEqual(await res!.json(), { error: 'Unauthorized' });
  });

  await test('machineSecretGuard — mismatched provided secret is rejected (401)', async () => {
    const res = machineSecretGuard('wrong-secret', SECRET, 'Machine secret not configured');
    assert.ok(res);
    assert.equal(res!.status, 401);
  });

  await test('machineSecretGuard — matching secret passes (null)', () => {
    const res = machineSecretGuard(SECRET, SECRET, 'Machine secret not configured');
    assert.equal(res, null);
  });

  report();
}

main();
