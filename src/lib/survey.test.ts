import assert from 'node:assert/strict';
import {
  CORE_SURVEY_QUESTIONS,
  buildSurveyQuestions,
  questionsToDrafts,
  summarizeSurvey,
  tallyVotes,
  validateQuestionDrafts,
  validateSuperlativeOrder,
  validateSuperlativeTitle,
  validateSuperlativeVotes,
  validateSurveyAnswers,
} from './survey';
import { test, report } from './test-support/miniTest';

const questions = [
  { id: 1, kind: 'rating' as const, prompt: 'r', is_core: false },
  { id: 2, kind: 'yes_no' as const, prompt: 'y', is_core: true },
  { id: 3, kind: 'text' as const, prompt: 't', is_core: true },
];

test('buildSurveyQuestions puts custom questions first, then core, with ids numbered from 1', () => {
  const built = buildSurveyQuestions([{ kind: 'text', prompt: 'Custom?' }]);
  assert.equal(built.length, CORE_SURVEY_QUESTIONS.length + 1);
  assert.deepEqual(built[0], { kind: 'text', prompt: 'Custom?', is_core: false, id: 1 });
  assert.equal(built[1].prompt, CORE_SURVEY_QUESTIONS[0].prompt);
  assert.ok(built.slice(1).every((q) => q.is_core));
  assert.deepEqual(built.map((q) => q.id), built.map((_, i) => i + 1));
});

test('validateQuestionDrafts trims prompts and rejects bad input', () => {
  assert.deepEqual(validateQuestionDrafts(undefined), { ok: true, value: [] });
  assert.deepEqual(validateQuestionDrafts([{ kind: 'rating', prompt: '  Hi  ' }]), {
    ok: true,
    value: [{ kind: 'rating', prompt: 'Hi' }],
  });
  assert.equal(validateQuestionDrafts('nope').ok, false);
  assert.equal(validateQuestionDrafts([{ kind: 'rating', prompt: '  ' }]).ok, false);
  assert.equal(validateQuestionDrafts([{ kind: 'slider', prompt: 'x' }]).ok, false);
  assert.equal(validateQuestionDrafts(Array.from({ length: 21 }, () => ({ kind: 'text', prompt: 'x' }))).ok, false);
});

test('buildSurveyQuestions honours the given order, core references included, and appends omitted core questions', () => {
  const built = buildSurveyQuestions([{ core: 2 }, { kind: 'text', prompt: 'Custom?' }, { core: 0 }]);
  assert.equal(built.length, CORE_SURVEY_QUESTIONS.length + 1);
  assert.deepEqual(built.slice(0, 3).map((q) => q.prompt), [CORE_SURVEY_QUESTIONS[2].prompt, 'Custom?', CORE_SURVEY_QUESTIONS[0].prompt]);
  assert.deepEqual(built.slice(0, 3).map((q) => q.is_core), [true, false, true]);
  assert.equal(built[3].prompt, CORE_SURVEY_QUESTIONS[1].prompt);
  assert.deepEqual(built.map((q) => q.id), built.map((_, i) => i + 1));
});

test('validateQuestionDrafts accepts core references and rejects bad or repeated ones', () => {
  assert.deepEqual(validateQuestionDrafts([{ core: 1 }]), { ok: true, value: [{ core: 1 }] });
  assert.equal(validateQuestionDrafts([{ core: 99 }]).ok, false);
  assert.equal(validateQuestionDrafts([{ core: '1' }]).ok, false);
  assert.equal(validateQuestionDrafts([{ core: 1 }, { core: 1 }]).ok, false);
  assert.equal(validateQuestionDrafts(['abc', 5]).ok, false);
});

test('validateSuperlativeOrder requires a permutation of the current ids', () => {
  assert.deepEqual(validateSuperlativeOrder([1, 2, 3], [3, 1, 2]), { ok: true, value: [3, 1, 2] });
  assert.equal(validateSuperlativeOrder([1, 2, 3], [1, 2]).ok, false);
  assert.equal(validateSuperlativeOrder([1, 2, 3], [1, 1, 2]).ok, false);
  assert.equal(validateSuperlativeOrder([1, 2, 3], [1, 2, 9]).ok, false);
  assert.equal(validateSuperlativeOrder([1], 'x').ok, false);
});

test('validateSurveyAnswers keeps typed answers and drops blanks', () => {
  assert.deepEqual(validateSurveyAnswers(questions, { 1: 4, 2: false, 3: '  great  ' }), {
    ok: true,
    value: { 1: 4, 2: false, 3: 'great' },
  });
  assert.deepEqual(validateSurveyAnswers(questions, { 1: null, 3: '   ' }), { ok: true, value: {} });
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

test('summarizeSurvey rolls up ratings, yes/no, and text across responses', () => {
  const summaries = summarizeSurvey(questions, [
    { 1: 4, 2: true, 3: 'fun' },
    { 1: 2, 2: true },
    { 2: false },
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
  // Ids are not coerced: a boolean, string, or array never stands in for a real id.
  assert.equal(validateSuperlativeVotes([1], [10], [{ superlative_id: true, nominee_player_id: 10 }]).ok, false);
  assert.equal(validateSuperlativeVotes([1], [10], [{ superlative_id: 1, nominee_player_id: '10' }]).ok, false);
  assert.equal(validateSuperlativeVotes([1], [10], [{ superlative_id: [1], nominee_player_id: 10 }]).ok, false);
});

test('tallyVotes orders by votes, then player id', () => {
  assert.deepEqual(tallyVotes([5, 3, 5, 3, 7]), [
    { player_id: 3, votes: 2 },
    { player_id: 5, votes: 2 },
    { player_id: 7, votes: 1 },
  ]);
  assert.deepEqual(tallyVotes([]), []);
});

test('questionsToDrafts round-trips a built list and turns a core question the list no longer has into a custom one', () => {
  const drafts = [{ kind: 'text' as const, prompt: 'Custom?' }, { core: 3 }];
  const built = buildSurveyQuestions(drafts);
  assert.deepEqual(buildSurveyQuestions(questionsToDrafts(built)), built);

  const stale = [{ id: 1, kind: 'rating' as const, prompt: 'A retired core question', is_core: true }];
  assert.deepEqual(questionsToDrafts(stale), [{ kind: 'rating', prompt: 'A retired core question' }]);
});

report();
