/**
 * Unit tests for discordLinkState.ts — the signed state param protecting the Discord
 * account-linking OAuth2 flow (#394).
 *
 * Run:  npx tsx src/lib/discordLinkState.test.ts
 */

import assert from 'node:assert/strict';
import { test, report } from './test-support/miniTest';
import { signDiscordLinkState, verifyDiscordLinkState } from './discordLinkState';
import { hmacSign } from './hmacSign';

process.env.NEXTAUTH_SECRET = 'test-secret-do-not-use-in-prod';

function decodePayload(state: string): { playerId: number; expires: number; sig: string } {
  return JSON.parse(Buffer.from(state, 'base64url').toString());
}

function encodePayload(payload: object): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

test('signDiscordLinkState/verifyDiscordLinkState: round-trips playerId', () => {
  const state = signDiscordLinkState(42);
  assert.deepEqual(verifyDiscordLinkState(state), { playerId: 42 });
});

test('verifyDiscordLinkState: rejects a state with a tampered playerId', () => {
  const payload = decodePayload(signDiscordLinkState(42));
  payload.playerId = 43; // claim a different player's link without re-signing
  assert.equal(verifyDiscordLinkState(encodePayload(payload)), null);
});

test('verifyDiscordLinkState: rejects an expired state even with a validly re-signed expiry', () => {
  const payload = decodePayload(signDiscordLinkState(42));
  payload.expires = Date.now() - 1000; // 1s in the past
  payload.sig = hmacSign(`${payload.playerId}:${payload.expires}`);
  assert.equal(verifyDiscordLinkState(encodePayload(payload)), null);
});

test('verifyDiscordLinkState: rejects garbage input rather than throwing', () => {
  assert.equal(verifyDiscordLinkState('not-a-real-token'), null);
  assert.equal(verifyDiscordLinkState(''), null);
});

test('verifyDiscordLinkState: rejects a well-formed but unsigned payload', () => {
  const forged = encodePayload({ playerId: 42, expires: Date.now() + 100000, sig: 'deadbeef' });
  assert.equal(verifyDiscordLinkState(forged), null);
});

report();
