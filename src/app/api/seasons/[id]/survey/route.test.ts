/**
 * POST/PUT/PATCH/DELETE /api/seasons/[id]/survey — admin sends, edits, closes, reopens, and resets a season's survey.
 * Run:  npx vitest run src/app/api/seasons/[id]/survey/route.test.ts
 */

import assert from 'node:assert/strict';
import type { NextRequest } from 'next/server';
import { jsonRequest } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import {
  ADMIN_ID, ALICE_ID, GAUNTLET_SEASON_ID, REGULAR_SEASON_ID, installFeedbackFixture, resetFeedbackFixture,
} from '@/lib/test-support/feedbackFixture';
import { CORE_SURVEY_QUESTIONS } from '@/lib/survey';
import { POST, PATCH, PUT, DELETE } from './route';

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

const call = (handler: Handler, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', seasonId: number | string, body: unknown) =>
  handler(jsonRequest(`http://localhost/api/seasons/${seasonId}/survey`, method, body), {
    params: Promise.resolve({ id: String(seasonId) }),
  });

test('POST — unauthenticated is rejected (401)', async () => {
  installFeedbackFixture(null);
  assert.equal((await call(POST, 'POST', REGULAR_SEASON_ID, {})).status, 401);
  resetFeedbackFixture();
});

test('POST — a non-admin is rejected (403)', async () => {
  installFeedbackFixture(ALICE_ID);
  assert.equal((await call(POST, 'POST', REGULAR_SEASON_ID, {})).status, 403);
  resetFeedbackFixture();
});

test('POST — a gauntlet season has no survey (404)', async () => {
  installFeedbackFixture(ADMIN_ID);
  assert.equal((await call(POST, 'POST', GAUNTLET_SEASON_ID, {})).status, 404);
  resetFeedbackFixture();
});

test('POST — an invalid custom question is rejected (400) and nothing is written', async () => {
  const db = installFeedbackFixture(ADMIN_ID);
  const res = await call(POST, 'POST', REGULAR_SEASON_ID, { questions: [{ kind: 'slider', prompt: 'x' }] });
  assert.equal(res.status, 400);
  assert.equal(db.surveys.length, 0);
  resetFeedbackFixture();
});

test('POST — creates an open survey with custom questions followed by the core ones (201)', async () => {
  const db = installFeedbackFixture(ADMIN_ID);
  const res = await call(POST, 'POST', REGULAR_SEASON_ID, { questions: [{ kind: 'text', prompt: 'Favorite map?' }] });
  assert.equal(res.status, 201);
  assert.equal(db.surveys.length, 1);
  assert.equal(db.surveys[0].closed_at ?? null, null);
  const questions = db.surveys[0].questions as { id: number; prompt: string; is_core: boolean }[];
  assert.deepEqual(questions.map((q) => q.prompt), ['Favorite map?', ...CORE_SURVEY_QUESTIONS.map((q) => q.prompt)]);
  assert.deepEqual(questions.map((q) => q.id), questions.map((_, i) => i + 1));
  assert.deepEqual(questions.map((q) => q.is_core), [false, ...CORE_SURVEY_QUESTIONS.map(() => true)]);
  resetFeedbackFixture();
});

test('POST — a second survey for the same season is rejected (409)', async () => {
  installFeedbackFixture(ADMIN_ID);
  assert.equal((await call(POST, 'POST', REGULAR_SEASON_ID, {})).status, 201);
  assert.equal((await call(POST, 'POST', REGULAR_SEASON_ID, {})).status, 409);
  resetFeedbackFixture();
});

test('PATCH — closes then reopens the survey; 404 when none exists; 400 for a bad body', async () => {
  const db = installFeedbackFixture(ADMIN_ID);
  assert.equal((await call(PATCH, 'PATCH', REGULAR_SEASON_ID, { open: false })).status, 404);
  await call(POST, 'POST', REGULAR_SEASON_ID, {});
  assert.equal((await call(PATCH, 'PATCH', REGULAR_SEASON_ID, { open: 'no' })).status, 400);
  assert.equal((await call(PATCH, 'PATCH', REGULAR_SEASON_ID, { open: false })).status, 200);
  assert.ok(db.surveys[0].closed_at);
  assert.equal((await call(PATCH, 'PATCH', REGULAR_SEASON_ID, { open: true })).status, 200);
  assert.equal(db.surveys[0].closed_at, null);
  resetFeedbackFixture();
});

test('POST — questions follow the admin order, with core questions placed among custom ones (201)', async () => {
  const db = installFeedbackFixture(ADMIN_ID);
  const res = await call(POST, 'POST', REGULAR_SEASON_ID, { questions: [{ core: 8 }, { kind: 'text', prompt: 'Mine?' }] });
  assert.equal(res.status, 201);
  const prompts = (db.surveys[0].questions as { prompt: string }[]).map((q) => q.prompt);
  assert.equal(prompts[0], CORE_SURVEY_QUESTIONS[8].prompt);
  assert.equal(prompts[1], 'Mine?');
  assert.equal(prompts.length, CORE_SURVEY_QUESTIONS.length + 1);
  resetFeedbackFixture();
});

test('POST — { open: false } saves the survey closed; a non-boolean open is rejected (400)', async () => {
  const db = installFeedbackFixture(ADMIN_ID);
  assert.equal((await call(POST, 'POST', REGULAR_SEASON_ID, { open: 'no' })).status, 400);
  assert.equal(db.surveys.length, 0);
  assert.equal((await call(POST, 'POST', REGULAR_SEASON_ID, { open: false })).status, 201);
  assert.notEqual(db.surveys[0].closed_at, null);
  resetFeedbackFixture();
});

test('DELETE — admin reset closes the survey and deletes its responses, keeping the questions; non-admin refused (403), none to reset (404)', async () => {
  installFeedbackFixture(ALICE_ID);
  assert.equal((await call(DELETE, 'DELETE', REGULAR_SEASON_ID, {})).status, 403);
  const db = installFeedbackFixture(ADMIN_ID);
  assert.equal((await call(DELETE, 'DELETE', REGULAR_SEASON_ID, {})).status, 404);

  await call(POST, 'POST', REGULAR_SEASON_ID, { questions: [{ kind: 'text', prompt: 'Thoughts?' }] });
  const questions = db.surveys[0].questions;
  db.survey_responses.push({ id: 1, survey_id: db.surveys[0].id, player_id: ALICE_ID, answers: {} });
  assert.equal((await call(DELETE, 'DELETE', REGULAR_SEASON_ID, {})).status, 200);
  assert.equal(db.survey_responses.length, 0);
  assert.equal(db.surveys.length, 1);
  assert.notEqual(db.surveys[0].closed_at, null);
  assert.deepEqual(db.surveys[0].questions, questions);
  resetFeedbackFixture();
});

test('PUT — replaces the questions only while the survey is closed with no responses', async () => {
  const db = installFeedbackFixture(ADMIN_ID);
  const edit = { questions: [{ kind: 'yes_no', prompt: 'Again?' }] };
  assert.equal((await call(PUT, 'PUT', REGULAR_SEASON_ID, edit)).status, 404);

  await call(POST, 'POST', REGULAR_SEASON_ID, {});
  assert.equal((await call(PUT, 'PUT', REGULAR_SEASON_ID, edit)).status, 409); // open

  await call(PATCH, 'PATCH', REGULAR_SEASON_ID, { open: false });
  assert.equal((await call(PUT, 'PUT', REGULAR_SEASON_ID, { questions: [{ kind: 'slider', prompt: 'x' }] })).status, 400);
  assert.equal((await call(PUT, 'PUT', REGULAR_SEASON_ID, edit)).status, 200);
  const stored = db.surveys[0].questions as { prompt: string }[];
  assert.equal(stored[0].prompt, 'Again?');
  assert.equal(stored.length, CORE_SURVEY_QUESTIONS.length + 1);

  assert.equal((await call(PUT, 'PUT', REGULAR_SEASON_ID, { ...edit, open: true })).status, 200);
  assert.equal(db.surveys[0].closed_at, null); // saved and opened in one request

  await call(PATCH, 'PATCH', REGULAR_SEASON_ID, { open: false });
  db.survey_responses.push({ id: 1, survey_id: db.surveys[0].id, player_id: ALICE_ID, answers: {} });
  assert.equal((await call(PUT, 'PUT', REGULAR_SEASON_ID, edit)).status, 409); // has a response
  resetFeedbackFixture();
});

test('PUT — a refused save leaves the stored questions and open state untouched', async () => {
  const db = installFeedbackFixture(ADMIN_ID);
  await call(POST, 'POST', REGULAR_SEASON_ID, { open: false });
  db.survey_responses.push({ id: 1, survey_id: db.surveys[0].id, player_id: ALICE_ID, answers: {} });
  const before = structuredClone(db.surveys[0]);
  const res = await call(PUT, 'PUT', REGULAR_SEASON_ID, { questions: [{ kind: 'yes_no', prompt: 'Again?' }], open: true });
  assert.equal(res.status, 409);
  assert.deepEqual(db.surveys[0], before);
  resetFeedbackFixture();
});

report();
