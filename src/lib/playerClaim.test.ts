/**
 * Unit tests for playerClaim.ts — the signed claim-link tokens that replaced self-declared
 * `existingPlayerId` linking (#322) in the player registration flow.
 *
 * Run:  npx tsx src/lib/playerClaim.test.ts
 */

import assert from 'node:assert/strict';
import { test, report } from './test-support/miniTest';
import { signPlayerClaim, verifyPlayerClaim } from './playerClaim';
import { hmacSign } from './hmacSign';

process.env.NEXTAUTH_SECRET = 'test-secret-do-not-use-in-prod';

function decodePayload(token: string): { playerId: number; name: string; expires: number; sig: string } {
  return JSON.parse(Buffer.from(token, 'base64url').toString());
}

function encodePayload(payload: object): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

test('signPlayerClaim/verifyPlayerClaim: round-trips playerId and name', () => {
  const token = signPlayerClaim(42, 'Dan');
  const claim = verifyPlayerClaim(token);
  assert.deepEqual(claim, { playerId: 42, name: 'Dan' });
});

test('verifyPlayerClaim: rejects a token with a tampered playerId', () => {
  const payload = decodePayload(signPlayerClaim(42, 'Dan'));
  payload.playerId = 43; // claim a different player without re-signing
  assert.equal(verifyPlayerClaim(encodePayload(payload)), null);
});

test('verifyPlayerClaim: name is unsigned — display-only, never a trust boundary', () => {
  // name isn't covered by the signature (only `${playerId}:${expires}` is), so a tampered name
  // still verifies. This is intentional: the register route only ever trusts the returned
  // playerId, exactly like RegisterModal's decodeClaimName() only uses name for display.
  const payload = decodePayload(signPlayerClaim(42, 'Dan'));
  payload.name = 'Not Dan';
  const claim = verifyPlayerClaim(encodePayload(payload));
  assert.deepEqual(claim, { playerId: 42, name: 'Not Dan' });
});

test('verifyPlayerClaim: rejects an expired token even with a validly re-signed expiry', () => {
  const payload = decodePayload(signPlayerClaim(42, 'Dan'));
  payload.expires = Date.now() - 1000; // 1s in the past
  payload.sig = hmacSign(`${payload.playerId}:${payload.expires}`);
  assert.equal(verifyPlayerClaim(encodePayload(payload)), null);
});

test('verifyPlayerClaim: rejects garbage input rather than throwing', () => {
  assert.equal(verifyPlayerClaim('not-a-real-token'), null);
  assert.equal(verifyPlayerClaim(''), null);
});

test('verifyPlayerClaim: rejects a well-formed but unsigned payload', () => {
  const forged = encodePayload({ playerId: 42, name: 'Dan', expires: Date.now() + 100000, sig: 'deadbeef' });
  assert.equal(verifyPlayerClaim(forged), null);
});

report();
