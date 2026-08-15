/**
 * Unit tests for discordInteractions.ts's Ed25519 signature verification and response helpers
 * (#396).
 *
 * Run:  npx vitest run src/lib/discordInteractions.test.ts
 */

import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  verifyDiscordSignature,
  pongResponse,
  messageResponse,
  optionValue,
  callerDiscordId,
  type DiscordInteraction,
} from './discordInteractions';
import { test, report } from './test-support/miniTest';

// A fresh Ed25519 keypair for these tests only — real verification against Discord's actual
// public key is exercised by the interactions route in production, not here.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicKeyHex = Buffer.from(
  (publicKey.export({ format: 'jwk' }) as { x: string }).x,
  'base64url',
).toString('hex');

function signPayload(timestamp: string, body: string): string {
  return sign(null, Buffer.from(timestamp + body), privateKey).toString('hex');
}

async function main() {
  await test('verifyDiscordSignature: accepts a validly signed payload', () => {
    const timestamp = '1700000000';
    const body = '{"type":1}';
    const signature = signPayload(timestamp, body);
    assert.equal(verifyDiscordSignature(publicKeyHex, signature, timestamp, body), true);
  });

  await test('verifyDiscordSignature: rejects a tampered body', () => {
    const timestamp = '1700000000';
    const signature = signPayload(timestamp, '{"type":1}');
    assert.equal(verifyDiscordSignature(publicKeyHex, signature, timestamp, '{"type":2}'), false);
  });

  await test('verifyDiscordSignature: rejects a tampered timestamp', () => {
    const body = '{"type":1}';
    const signature = signPayload('1700000000', body);
    assert.equal(verifyDiscordSignature(publicKeyHex, signature, '1700000001', body), false);
  });

  await test('verifyDiscordSignature: rejects garbage input rather than throwing', () => {
    assert.equal(verifyDiscordSignature(publicKeyHex, 'not-hex', '1700000000', '{}'), false);
    assert.equal(verifyDiscordSignature('not-hex-either', 'deadbeef', '1700000000', '{}'), false);
  });

  await test('pongResponse: PONG shape', () => {
    assert.deepEqual(pongResponse(), { type: 1 });
  });

  await test('messageResponse: defaults to public (no flags)', () => {
    const res = messageResponse('hi');
    assert.equal(res.type, 4);
    assert.equal(res.data.content, 'hi');
    assert.equal(res.data.flags, undefined);
  });

  await test('messageResponse: ephemeral=true sets the ephemeral flag', () => {
    const res = messageResponse('hi', true);
    assert.equal(res.data.flags, 64);
  });

  await test('optionValue: reads a named option', () => {
    const interaction: DiscordInteraction = {
      type: 2,
      data: { name: 'leaderboard', options: [{ name: 'season', value: 5 }] },
    };
    assert.equal(optionValue(interaction, 'season'), 5);
    assert.equal(optionValue(interaction, 'missing'), undefined);
  });

  await test('callerDiscordId: prefers member.user.id (guild context)', () => {
    const interaction: DiscordInteraction = {
      type: 2,
      member: { user: { id: 'guild-user' } },
      user: { id: 'dm-user' },
    };
    assert.equal(callerDiscordId(interaction), 'guild-user');
  });

  await test('callerDiscordId: falls back to user.id (DM context)', () => {
    const interaction: DiscordInteraction = { type: 2, user: { id: 'dm-user' } };
    assert.equal(callerDiscordId(interaction), 'dm-user');
  });

  await test('callerDiscordId: null when neither is present', () => {
    assert.equal(callerDiscordId({ type: 2 }), null);
  });

  report();
}

await main();
