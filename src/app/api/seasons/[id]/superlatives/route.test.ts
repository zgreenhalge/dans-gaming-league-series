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
import { POST, DELETE, PATCH } from './route';

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

const call = (handler: Handler, method: 'POST' | 'DELETE' | 'PATCH', seasonId: number, body: unknown) =>
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

report();
