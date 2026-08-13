/**
 * Covers `secretsMatch()` (equal secrets, unequal secrets, and that a mismatch is caught regardless
 * of which byte it's at — `secretsMatch()` delegates to `node:crypto`'s `timingSafeEqual`, which is
 * constant-time by contract, rather than a manual loop that could short-circuit on the first
 * mismatched byte) and `machineSecretGuard()`'s three outcomes (secret not configured, provided
 * secret doesn't match, provided secret matches).
 *
 * Run:  npx tsx src/lib/machine-auth.test.ts
 */

import assert from 'node:assert/strict';
import { test, report } from './test-support/miniTest';
import { secretsMatch, machineSecretGuard } from './machine-auth';

const SECRET = 'a'.repeat(64);

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

  await test('secretsMatch — a mismatch at the first byte does not match', () => {
    assert.equal(secretsMatch('b' + SECRET.slice(1), SECRET), false);
  });

  await test('secretsMatch — a mismatch at the last byte does not match', () => {
    assert.equal(secretsMatch(SECRET.slice(0, -1) + 'b', SECRET), false);
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
