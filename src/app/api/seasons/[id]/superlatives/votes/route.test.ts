/**
 * PUT /api/seasons/[id]/superlatives/votes — a player who played the season casts and edits their
 * ballot; tallies stay anonymous.
 * Run:  npx vitest run src/app/api/seasons/[id]/superlatives/votes/route.test.ts
 */

import assert from 'node:assert/strict';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import {
  ADMIN_ID, ALICE_ID, BOB_ID, CARA_ID, REGULAR_SEASON_ID, installFeedbackFixture, resetFeedbackFixture,
} from '@/lib/test-support/feedbackFixture';
import { __setTestSession } from '@/lib/session';
import { getPlayerSuperlativeVotes, getSuperlativeResults, getPlayerFeedbackStatus } from '@/lib/queries';
import type { FakeDb } from '@/lib/test-support/fakeSupabase';
import { PUT } from './route';

const put = (body: unknown) =>
  PUT(jsonRequest(`http://localhost/api/seasons/${REGULAR_SEASON_ID}/superlatives/votes`, 'PUT', body), {
    params: Promise.resolve({ id: String(REGULAR_SEASON_ID) }),
  });

function seedPoll(db: FakeDb, isOpen = true) {
  db.superlative_polls.push({ season_id: REGULAR_SEASON_ID, is_open: isOpen });
  db.superlatives.push(
    { id: 1, season_id: REGULAR_SEASON_ID, position: 1, title: 'MVP' },
    { id: 2, season_id: REGULAR_SEASON_ID, position: 2, title: 'Best Teammate' },
  );
}

test('rejects unauthenticated (401), ineligible (403), no poll (404), and closed voting (409)', async () => {
  const db = installFeedbackFixture(null);
  assert.equal((await put({ votes: [] })).status, 401);
  __setTestSession(sessionFor(CARA_ID));
  assert.equal((await put({ votes: [] })).status, 403);
  __setTestSession(sessionFor(ALICE_ID));
  assert.equal((await put({ votes: [] })).status, 404);
  seedPoll(db, false);
  assert.equal((await put({ votes: [] })).status, 409);
  resetFeedbackFixture();
});

test('rejects a nominee who did not play (400) and a double vote on one superlative (400)', async () => {
  const db = installFeedbackFixture(ALICE_ID);
  seedPoll(db);
  assert.equal((await put({ votes: [{ superlative_id: 1, nominee_player_id: CARA_ID }] })).status, 400);
  assert.equal(
    (await put({ votes: [{ superlative_id: 1, nominee_player_id: BOB_ID }, { superlative_id: 1, nominee_player_id: ADMIN_ID }] })).status,
    400,
  );
  assert.equal(db.superlative_votes.length, 0);
  resetFeedbackFixture();
});

test('stores a ballot, allows a self-vote, and edits replace it (omitted superlatives cleared)', async () => {
  const db = installFeedbackFixture(ALICE_ID);
  seedPoll(db);
  assert.equal(
    (await put({ votes: [{ superlative_id: 1, nominee_player_id: ALICE_ID }, { superlative_id: 2, nominee_player_id: BOB_ID }] })).status,
    200,
  );
  assert.deepEqual(await getPlayerSuperlativeVotes(REGULAR_SEASON_ID, ALICE_ID), { 1: ALICE_ID, 2: BOB_ID });

  assert.equal((await put({ votes: [{ superlative_id: 1, nominee_player_id: ADMIN_ID }] })).status, 200);
  assert.deepEqual(await getPlayerSuperlativeVotes(REGULAR_SEASON_ID, ALICE_ID), { 1: ADMIN_ID });
  assert.equal(db.superlative_votes.length, 1);
  resetFeedbackFixture();
});

test('tallies are anonymous and ordered; status reflects whether the player has voted', async () => {
  const db = installFeedbackFixture(ALICE_ID);
  seedPoll(db);
  assert.deepEqual(await getPlayerFeedbackStatus(REGULAR_SEASON_ID, ALICE_ID), {
    survey: null,
    superlatives: { answered: false },
  });
  await put({ votes: [{ superlative_id: 1, nominee_player_id: BOB_ID }] });
  __setTestSession(sessionFor(ADMIN_ID));
  await put({ votes: [{ superlative_id: 1, nominee_player_id: BOB_ID }, { superlative_id: 2, nominee_player_id: ALICE_ID }] });

  const results = await getSuperlativeResults(REGULAR_SEASON_ID);
  assert.ok(results);
  assert.equal(results.voterCount, 2);
  assert.equal(results.eligibleCount, 3);
  assert.deepEqual(results.superlatives[0].nominees, [{ player_id: BOB_ID, player_name: 'Bob', votes: 2 }]);
  assert.deepEqual(results.superlatives[1].nominees, [{ player_id: ALICE_ID, player_name: 'Alice', votes: 1 }]);
  assert.ok(!JSON.stringify(results).includes('voter'.concat('_player_id')));
  assert.deepEqual(await getPlayerFeedbackStatus(REGULAR_SEASON_ID, ALICE_ID), {
    survey: null,
    superlatives: { answered: true },
  });
  assert.equal(await getPlayerFeedbackStatus(REGULAR_SEASON_ID, CARA_ID), null);
  resetFeedbackFixture();
});

report();
