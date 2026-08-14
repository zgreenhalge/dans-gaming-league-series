/**
 * Unit tests for hmacSign.ts — the shared HMAC signer/verifier behind the Steam login handoff
 * token (authOptions.js, api/auth/steam/callback) and player claim links (playerClaim.ts).
 *
 * Run:  npx vitest run src/lib/hmacSign.test.ts
 */

import assert from 'node:assert/strict';
import { test, report } from './test-support/miniTest';
import { hmacSign, hmacVerify } from './hmacSign';

// hmacSign()/hmacVerify() read NEXTAUTH_SECRET lazily (inside the function body, not at import
// time), so setting it here — before any test() call runs — is sufficient.
process.env.NEXTAUTH_SECRET = 'test-secret-do-not-use-in-prod';

test('hmacSign: same payload always produces the same signature', () => {
  assert.equal(hmacSign('a:1'), hmacSign('a:1'));
});

test('hmacSign: different payloads produce different signatures', () => {
  assert.notEqual(hmacSign('a:1'), hmacSign('a:2'));
});

test('hmacSign: throws if NEXTAUTH_SECRET is unset, rather than signing with an undefined key', () => {
  const saved = process.env.NEXTAUTH_SECRET;
  delete process.env.NEXTAUTH_SECRET;
  try {
    assert.throws(() => hmacSign('a:1'));
  } finally {
    process.env.NEXTAUTH_SECRET = saved;
  }
});

test('hmacVerify: accepts a signature freshly produced by hmacSign for the same payload', () => {
  assert.equal(hmacVerify('a:1', hmacSign('a:1')), true);
});

test('hmacVerify: rejects a signature computed for a different payload', () => {
  assert.equal(hmacVerify('a:1', hmacSign('a:2')), false);
});

test('hmacVerify: rejects a truncated signature rather than throwing', () => {
  const sig = hmacSign('a:1');
  assert.equal(hmacVerify('a:1', sig.slice(0, -2)), false);
});

test('hmacVerify: rejects non-hex garbage rather than throwing', () => {
  assert.equal(hmacVerify('a:1', 'not-a-hex-signature'), false);
});

test('hmacVerify: rejects an empty signature rather than throwing', () => {
  assert.equal(hmacVerify('a:1', ''), false);
});

report();
