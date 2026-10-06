/**
 * POST/DELETE/PATCH /api/seasons/[id]/superlatives — admin chooses a season's superlatives and
 * opens/closes the vote.
 * Run:  npx vitest run src/app/api/seasons/[id]/superlatives/route.test.ts
 */

import assert from 'node:assert/strict';
import type { NextRequest } from 'next/server';
import { jsonRequest } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import {
  ADMIN_ID, ALICE_ID, GAUNTLET_SEASON_ID, REGULAR_SEASON_ID, installFeedbackFixture, resetFeedbackFixture,
} from '@/lib/test-support/feedbackFixture';
import { POST, DELETE, PATCH, PUT } from './route';

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

const call = (handler: Handler, method: 'POST' | 'DELETE' | 'PATCH' | 'PUT', seasonId: number, body: unknown) =>
  handler(jsonRequest(`http://localhost/api/seasons/${seasonId}/superlatives`, method, body), {
    params: Promise.resolve({ id: String(seasonId) }),
  });

test('every handler rejects a non-admin (403) and a gauntlet season (404)', async () => {
  installFeedbackFixture(ALICE_ID);
  assert.equal((await call(POST, 'POST', REGULAR_SEASON_ID, { title: 'x' })).status, 403);
  assert.equal((await call(PATCH, 'PATCH', REGULAR_SEASON_ID, { open: true })).status, 403);
  installFeedbackFixture(ADMIN_ID);
  assert.equal((await call(POST, 'POST', GAUNTLET_SEASON_ID, { title: 'x' })).status, 404);
  resetFeedbackFixture();
});

test('POST — first superlative creates a closed poll; duplicate titles (any case) are rejected (409)', async () => {
  const db = installFeedbackFixture(ADMIN_ID);
  assert.equal((await call(POST, 'POST', REGULAR_SEASON_ID, { title: ' Best Teammate ' })).status, 201);
  assert.equal(db.superlative_polls.length, 1);
  assert.ok(!db.superlative_polls[0].is_open);
  assert.equal(db.superlatives[0].title, 'Best Teammate');
  assert.equal((await call(POST, 'POST', REGULAR_SEASON_ID, { title: 'best teammate' })).status, 409);
  assert.equal((await call(POST, 'POST', REGULAR_SEASON_ID, { title: '  ' })).status, 400);
  assert.equal((await call(POST, 'POST', REGULAR_SEASON_ID, { title: 'Clutch King' })).status, 201);
  assert.deepEqual(db.superlatives.map((s) => s.position), [1, 2]);
  resetFeedbackFixture();
});

test('PATCH — opens and closes voting; cannot open an empty poll', async () => {
  const db = installFeedbackFixture(ADMIN_ID);
  assert.equal((await call(PATCH, 'PATCH', REGULAR_SEASON_ID, { open: true })).status, 404);
  await call(POST, 'POST', REGULAR_SEASON_ID, { title: 'MVP' });
  assert.equal((await call(PATCH, 'PATCH', REGULAR_SEASON_ID, { open: 'yes' })).status, 400);
  assert.equal((await call(PATCH, 'PATCH', REGULAR_SEASON_ID, { open: true })).status, 200);
  assert.equal(db.superlative_polls[0].is_open, true);
  assert.equal((await call(PATCH, 'PATCH', REGULAR_SEASON_ID, { open: false })).status, 200);
  assert.equal(db.superlative_polls[0].is_open, false);
  resetFeedbackFixture();
});

test('PATCH — a poll whose superlatives were all removed cannot be opened (400)', async () => {
  const db = installFeedbackFixture(ADMIN_ID);
  await call(POST, 'POST', REGULAR_SEASON_ID, { title: 'MVP' });
  const id = db.superlatives[0].id;
  assert.equal((await call(DELETE, 'DELETE', REGULAR_SEASON_ID, { superlative_id: id })).status, 200);
  assert.equal((await call(PATCH, 'PATCH', REGULAR_SEASON_ID, { open: true })).status, 400);
  resetFeedbackFixture();
});

test('DELETE — removes a superlative; unknown ids are 404, missing id is 400', async () => {
  const db = installFeedbackFixture(ADMIN_ID);
  await call(POST, 'POST', REGULAR_SEASON_ID, { title: 'MVP' });
  assert.equal((await call(DELETE, 'DELETE', REGULAR_SEASON_ID, {})).status, 400);
  assert.equal((await call(DELETE, 'DELETE', REGULAR_SEASON_ID, { superlative_id: 999 })).status, 404);
  assert.equal((await call(DELETE, 'DELETE', REGULAR_SEASON_ID, { superlative_id: db.superlatives[0].id })).status, 200);
  assert.equal(db.superlatives.length, 0);
  resetFeedbackFixture();
});

test('PUT — reorders superlatives; rejects a non-permutation (400) and an empty poll (404)', async () => {
  const db = installFeedbackFixture(ADMIN_ID);
  assert.equal((await call(PUT, 'PUT', REGULAR_SEASON_ID, { order: [] })).status, 404);
  await call(POST, 'POST', REGULAR_SEASON_ID, { title: 'A' });
  await call(POST, 'POST', REGULAR_SEASON_ID, { title: 'B' });
  const [a, b] = db.superlatives.map((s) => s.id as number);
  assert.equal((await call(PUT, 'PUT', REGULAR_SEASON_ID, { order: [a] })).status, 400);
  assert.equal((await call(PUT, 'PUT', REGULAR_SEASON_ID, { order: [b, a] })).status, 200);
  assert.equal(db.superlatives.find((s) => s.id === b)!.position, 1);
  assert.equal(db.superlatives.find((s) => s.id === a)!.position, 2);
  resetFeedbackFixture();
});

test('PATCH — renames a superlative only while voting is closed and it has no votes', async () => {
  const db = installFeedbackFixture(ADMIN_ID);
  await call(POST, 'POST', REGULAR_SEASON_ID, { title: 'A' });
  await call(POST, 'POST', REGULAR_SEASON_ID, { title: 'B' });
  const [a, b] = db.superlatives.map((s) => s.id as number);
  assert.equal((await call(PATCH, 'PATCH', REGULAR_SEASON_ID, { superlative_id: 999, title: 'X' })).status, 404);
  assert.equal((await call(PATCH, 'PATCH', REGULAR_SEASON_ID, { superlative_id: a, title: '  ' })).status, 400);
  assert.equal((await call(PATCH, 'PATCH', REGULAR_SEASON_ID, { superlative_id: a, title: 'b' })).status, 409);
  assert.equal((await call(PATCH, 'PATCH', REGULAR_SEASON_ID, { superlative_id: a, title: ' Renamed ' })).status, 200);
  assert.equal(db.superlatives.find((s) => s.id === a)!.title, 'Renamed');
  db.superlative_votes.push({ id: 1, superlative_id: b, voter_player_id: ALICE_ID, nominee_player_id: ADMIN_ID });
  assert.equal((await call(PATCH, 'PATCH', REGULAR_SEASON_ID, { superlative_id: b, title: 'C' })).status, 409);
  await call(PATCH, 'PATCH', REGULAR_SEASON_ID, { open: true });
  assert.equal((await call(PATCH, 'PATCH', REGULAR_SEASON_ID, { superlative_id: a, title: 'D' })).status, 409);
  resetFeedbackFixture();
});

report();
