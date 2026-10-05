import assert from 'node:assert/strict';
import {
  CORE_SURVEY_QUESTIONS,
  buildSurveyQuestionRows,
  summarizeSurvey,
  tallyVotes,
  validateCustomQuestions,
  validateSuperlativeTitle,
  validateSuperlativeVotes,
  validateSurveyAnswers,
} from './survey';
import { test, report } from './test-support/miniTest';

const questions = [
  { id: 1, position: 1, kind: 'rating' as const, prompt: 'r', is_core: false },
  { id: 2, position: 2, kind: 'yes_no' as const, prompt: 'y', is_core: true },
  { id: 3, position: 3, kind: 'text' as const, prompt: 't', is_core: true },
];

test('buildSurveyQuestionRows puts custom questions first, then core, numbered from 1', () => {
  const rows = buildSurveyQuestionRows([{ kind: 'text', prompt: 'Custom?' }]);
  assert.equal(rows.length, CORE_SURVEY_QUESTIONS.length + 1);
  assert.deepEqual(rows[0], { kind: 'text', prompt: 'Custom?', is_core: false, position: 1 });
  assert.equal(rows[1].prompt, CORE_SURVEY_QUESTIONS[0].prompt);
  assert.ok(rows.slice(1).every((r) => r.is_core));
  assert.deepEqual(rows.map((r) => r.position), rows.map((_, i) => i + 1));
});

test('validateCustomQuestions trims prompts and rejects bad input', () => {
  assert.deepEqual(validateCustomQuestions(undefined), { ok: true, value: [] });
  assert.deepEqual(validateCustomQuestions([{ kind: 'rating', prompt: '  Hi  ' }]), {
    ok: true,
    value: [{ kind: 'rating', prompt: 'Hi' }],
  });
  assert.equal(validateCustomQuestions('nope').ok, false);
  assert.equal(validateCustomQuestions([{ kind: 'rating', prompt: '  ' }]).ok, false);
  assert.equal(validateCustomQuestions([{ kind: 'slider', prompt: 'x' }]).ok, false);
  assert.equal(validateCustomQuestions(Array.from({ length: 21 }, () => ({ kind: 'text', prompt: 'x' }))).ok, false);
});

test('validateSurveyAnswers maps answers by kind and drops blanks', () => {
  const result = validateSurveyAnswers(questions, { 1: 4, 2: true, 3: '  great  ' });
  assert.deepEqual(result, {
    ok: true,
    value: [
      { question_id: 1, answer_number: 4, answer_text: null },
      { question_id: 2, answer_number: 1, answer_text: null },
      { question_id: 3, answer_number: null, answer_text: 'great' },
    ],
  });
  assert.deepEqual(validateSurveyAnswers(questions, { 1: null, 3: '   ' }), { ok: true, value: [] });
});

test('validateSurveyAnswers rejects wrong shapes, out-of-range ratings, and unknown questions', () => {
  assert.equal(validateSurveyAnswers(questions, { 1: 6 }).ok, false);
  assert.equal(validateSurveyAnswers(questions, { 1: 0 }).ok, false);
  assert.equal(validateSurveyAnswers(questions, { 1: 3.5 }).ok, false);
  assert.equal(validateSurveyAnswers(questions, { 2: 1 }).ok, false);
  assert.equal(validateSurveyAnswers(questions, { 3: 5 }).ok, false);
  assert.equal(validateSurveyAnswers(questions, { 99: 3 }).ok, false);
  assert.equal(validateSurveyAnswers(questions, [1, 2]).ok, false);
});

test('summarizeSurvey rolls up ratings, yes/no, and text without any player linkage', () => {
  const summaries = summarizeSurvey(questions, [
    { question_id: 1, answer_number: 4, answer_text: null },
    { question_id: 1, answer_number: 2, answer_text: null },
    { question_id: 2, answer_number: 1, answer_text: null },
    { question_id: 2, answer_number: 1, answer_text: null },
    { question_id: 2, answer_number: 0, answer_text: null },
    { question_id: 3, answer_number: null, answer_text: 'fun' },
  ]);
  assert.equal(summaries[0].average, 3);
  assert.deepEqual(summaries[0].distribution, [0, 1, 0, 1, 0]);
  assert.equal(summaries[0].answered, 2);
  assert.deepEqual([summaries[1].yes, summaries[1].no], [2, 1]);
  assert.deepEqual(summaries[2].texts, ['fun']);
  assert.equal(summarizeSurvey(questions, [])[0].average, null);
});

test('validateSuperlativeTitle trims and bounds titles', () => {
  assert.deepEqual(validateSuperlativeTitle('  Best Teammate '), { ok: true, value: 'Best Teammate' });
  assert.equal(validateSuperlativeTitle('   ').ok, false);
  assert.equal(validateSuperlativeTitle(42).ok, false);
  assert.equal(validateSuperlativeTitle('x'.repeat(81)).ok, false);
});

test('validateSuperlativeVotes checks superlatives, nominees, and one vote per superlative', () => {
  const ok = validateSuperlativeVotes([1, 2], [10, 11], [{ superlative_id: 1, nominee_player_id: 10 }]);
  assert.deepEqual(ok, { ok: true, value: [{ superlative_id: 1, nominee_player_id: 10 }] });
  assert.equal(validateSuperlativeVotes([1], [10], [{ superlative_id: 9, nominee_player_id: 10 }]).ok, false);
  assert.equal(validateSuperlativeVotes([1], [10], [{ superlative_id: 1, nominee_player_id: 99 }]).ok, false);
  assert.equal(
    validateSuperlativeVotes([1], [10, 11], [
      { superlative_id: 1, nominee_player_id: 10 },
      { superlative_id: 1, nominee_player_id: 11 },
    ]).ok,
    false,
  );
  assert.equal(validateSuperlativeVotes([1], [10], 'x').ok, false);
});

test('tallyVotes orders by votes, then player id', () => {
  assert.deepEqual(tallyVotes([5, 3, 5, 3, 7]), [
    { player_id: 3, votes: 2 },
    { player_id: 5, votes: 2 },
    { player_id: 7, votes: 1 },
  ]);
  assert.deepEqual(tallyVotes([]), []);
});

report();
