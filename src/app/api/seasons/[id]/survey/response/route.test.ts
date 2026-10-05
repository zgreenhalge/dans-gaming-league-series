/**
 * PUT /api/seasons/[id]/survey/response — a player who played the season submits and edits their
 * single response; results stay anonymous.
 * Run:  npx vitest run src/app/api/seasons/[id]/survey/response/route.test.ts
 */

import assert from 'node:assert/strict';
import { jsonRequest } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import {
  ADMIN_ID, ALICE_ID, BOB_ID, CARA_ID, REGULAR_SEASON_ID, GAUNTLET_SEASON_ID, installFeedbackFixture, resetFeedbackFixture,
} from '@/lib/test-support/feedbackFixture';
import { __setTestSession } from '@/lib/session';
import { sessionFor } from '@/lib/test-support/nextRequest';
import { getSurveyForSeason, getSurveyResults, getPlayerSurveyAnswers, getSeasonFeedbackView } from '@/lib/queries';
import type { FakeDb } from '@/lib/test-support/fakeSupabase';
import { PUT } from './route';

const put = (seasonId: number | string, body: unknown) =>
  PUT(jsonRequest(`http://localhost/api/seasons/${seasonId}/survey/response`, 'PUT', body), {
    params: Promise.resolve({ id: String(seasonId) }),
  });

/** Seeds a survey directly (rather than via the admin route) with one rating, one yes/no, one text. */
function seedSurvey(db: FakeDb, closed = false) {
  db.surveys.push({
    id: 1,
    season_id: REGULAR_SEASON_ID,
    closed_at: closed ? '2026-02-01' : null,
    questions: [
      { id: 1, kind: 'rating', prompt: 'Rate it', is_core: false },
      { id: 2, kind: 'yes_no', prompt: 'Again?', is_core: true },
      { id: 3, kind: 'text', prompt: 'Comments?', is_core: true },
    ],
  });
}

test('rejects unauthenticated (401), ineligible (403), gauntlet (404), and a missing survey (404)', async () => {
  const db = installFeedbackFixture(null);
  seedSurvey(db);
  assert.equal((await put(REGULAR_SEASON_ID, { answers: {} })).status, 401);
  __setTestSession(sessionFor(CARA_ID)); // only on an unplayed placeholder match
  assert.equal((await put(REGULAR_SEASON_ID, { answers: {} })).status, 403);
  __setTestSession(sessionFor(ALICE_ID));
  assert.equal((await put(GAUNTLET_SEASON_ID, { answers: {} })).status, 404);
  db.surveys.length = 0;
  assert.equal((await put(REGULAR_SEASON_ID, { answers: {} })).status, 404);
  resetFeedbackFixture();
});

test('rejects a closed survey (409)', async () => {
  const db = installFeedbackFixture(ALICE_ID);
  seedSurvey(db, true);
  assert.equal((await put(REGULAR_SEASON_ID, { answers: { 1: 3 } })).status, 409);
  assert.equal(db.survey_responses.length, 0);
  resetFeedbackFixture();
});

test('rejects invalid answers (400) without creating a response', async () => {
  const db = installFeedbackFixture(ALICE_ID);
  seedSurvey(db);
  assert.equal((await put(REGULAR_SEASON_ID, { answers: { 1: 9 } })).status, 400);
  assert.equal((await put(REGULAR_SEASON_ID, { answers: { 99: 3 } })).status, 400);
  assert.equal(db.survey_responses.length, 0);
  resetFeedbackFixture();
});

test('stores a response, then edits it in place — one response per player, omitted answers cleared', async () => {
  const db = installFeedbackFixture(ALICE_ID);
  seedSurvey(db);
  assert.equal((await put(REGULAR_SEASON_ID, { answers: { 1: 4, 2: true, 3: 'fun' } })).status, 200);
  assert.equal(db.survey_responses.length, 1);
  assert.deepEqual(db.survey_responses[0].answers, { 1: 4, 2: true, 3: 'fun' });

  assert.equal((await put(REGULAR_SEASON_ID, { answers: { 1: 2, 2: false } })).status, 200);
  assert.equal(db.survey_responses.length, 1);
  assert.deepEqual(db.survey_responses[0].answers, { 1: 2, 2: false });
  const mine = await getPlayerSurveyAnswers(1, ALICE_ID);
  assert.deepEqual(mine, { responded: true, answers: { 1: 2, 2: false } });
  resetFeedbackFixture();
});

test('an admin who played the season can respond like any other player', async () => {
  const db = installFeedbackFixture(ADMIN_ID);
  seedSurvey(db);
  assert.equal((await put(REGULAR_SEASON_ID, { answers: { 1: 5 } })).status, 200);
  resetFeedbackFixture();
});

test('results are anonymous: aggregates only, no player ids anywhere', async () => {
  const db = installFeedbackFixture(ALICE_ID);
  seedSurvey(db);
  await put(REGULAR_SEASON_ID, { answers: { 1: 4, 2: true, 3: 'fun' } });
  __setTestSession(sessionFor(BOB_ID));
  await put(REGULAR_SEASON_ID, { answers: { 1: 2, 2: false, 3: 'meh' } });

  const results = await getSurveyResults(REGULAR_SEASON_ID);
  assert.ok(results);
  assert.equal(results.responseCount, 2);
  assert.equal(results.eligibleCount, 3); // admin, Alice, Bob played; Cara did not
  assert.equal(results.summaries[0].average, 3);
  assert.deepEqual([results.summaries[1].yes, results.summaries[1].no], [1, 1]);
  assert.deepEqual([...results.summaries[2].texts].sort(), ['fun', 'meh']);
  assert.ok(await getSurveyForSeason(REGULAR_SEASON_ID));
  assert.ok(!JSON.stringify(results).includes('player'));
  resetFeedbackFixture();
});

test('season feedback view: the survey tab exists only while open, for a viewer who played', async () => {
  const db = installFeedbackFixture(ALICE_ID);
  seedSurvey(db);
  await put(REGULAR_SEASON_ID, { answers: { 1: 4 } });

  const view = await getSeasonFeedbackView(REGULAR_SEASON_ID, ALICE_ID);
  assert.equal(view.survey?.responded, true);
  assert.deepEqual(view.survey?.answers, { 1: 4 });
  assert.equal(view.survey?.questions.length, 3);
  assert.equal((await getSeasonFeedbackView(REGULAR_SEASON_ID, CARA_ID)).survey, null);
  assert.equal((await getSeasonFeedbackView(REGULAR_SEASON_ID, null)).survey, null);

  db.surveys[0].closed_at = '2026-02-01';
  assert.equal((await getSeasonFeedbackView(REGULAR_SEASON_ID, ALICE_ID)).survey, null);
  resetFeedbackFixture();
});

test('season feedback view: a closed vote\'s public results show even while the survey is open', async () => {
  const db = installFeedbackFixture(ALICE_ID);
  seedSurvey(db);
  db.superlative_polls.push({ season_id: REGULAR_SEASON_ID, is_open: false });
  db.superlatives.push({ id: 1, season_id: REGULAR_SEASON_ID, position: 1, title: 'MVP' });
  db.superlative_votes.push({ id: 1, superlative_id: 1, voter_player_id: ALICE_ID, nominee_player_id: BOB_ID });

  for (const viewer of [ALICE_ID, CARA_ID, null]) {
    const view = await getSeasonFeedbackView(REGULAR_SEASON_ID, viewer);
    assert.equal(view.superlatives?.mode, 'results');
  }
  assert.ok((await getSeasonFeedbackView(REGULAR_SEASON_ID, ALICE_ID)).survey);
  assert.equal((await getSeasonFeedbackView(REGULAR_SEASON_ID, CARA_ID)).survey, null);
  resetFeedbackFixture();
});

report();
