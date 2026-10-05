// Pure logic for the post-season survey and the superlatives vote — question definitions,
// input validation, and result summarising. No IO, so the routes, queries, and tests all share it.

export type SurveyQuestionKind = 'rating' | 'yes_no' | 'text';

export const RATING_MIN = 1;
export const RATING_MAX = 5;
export const RATING_LABELS: Record<number, string> = {
  1: 'Poor',
  2: 'Meh',
  3: 'Okay',
  4: 'Good',
  5: 'Great',
};

export const MAX_CUSTOM_QUESTIONS = 20;
export const MAX_PROMPT_LENGTH = 200;
export const MAX_TEXT_ANSWER_LENGTH = 2000;
export const MAX_SUPERLATIVE_TITLE_LENGTH = 80;

export interface SurveyQuestionInput {
  kind: SurveyQuestionKind;
  prompt: string;
}

/** The questions every survey ends with, in order. Copied into `survey_questions` when a survey is
 *  created, so editing this list only affects surveys created afterward. */
export const CORE_SURVEY_QUESTIONS: readonly SurveyQuestionInput[] = [
  { kind: 'rating', prompt: 'How did you feel about the length of games?' },
  { kind: 'rating', prompt: 'How did you feel about the length of the regular season?' },
  { kind: 'rating', prompt: 'How did you feel about the length of the playoffs?' },
  { kind: 'rating', prompt: 'How did you feel about the buy-in?' },
  { kind: 'rating', prompt: 'How did you feel about the size of the map pool?' },
  { kind: 'rating', prompt: 'How did you feel about the quality of the map pool?' },
  { kind: 'rating', prompt: 'How did you feel about the league overall?' },
  { kind: 'yes_no', prompt: 'Are you interested in participating again?' },
  { kind: 'text', prompt: 'Any additional comments?' },
];

const KINDS: readonly SurveyQuestionKind[] = ['rating', 'yes_no', 'text'];

export interface SurveyQuestionRow extends SurveyQuestionInput {
  position: number;
  is_core: boolean;
}

/** The `survey_questions` rows for a new survey: the admin's custom questions first, then the core
 *  ones, numbered from 1. */
export function buildSurveyQuestionRows(custom: SurveyQuestionInput[]): SurveyQuestionRow[] {
  return [
    ...custom.map((q) => ({ ...q, is_core: false })),
    ...CORE_SURVEY_QUESTIONS.map((q) => ({ ...q, is_core: true })),
  ].map((q, i) => ({ ...q, position: i + 1 }));
}

type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validates the admin-supplied custom question list from a request body. An empty or missing list
 *  is fine (a survey of just the core questions). */
export function validateCustomQuestions(input: unknown): Validated<SurveyQuestionInput[]> {
  if (input == null) return { ok: true, value: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'questions must be an array' };
  if (input.length > MAX_CUSTOM_QUESTIONS) {
    return { ok: false, error: `At most ${MAX_CUSTOM_QUESTIONS} custom questions` };
  }
  const questions: SurveyQuestionInput[] = [];
  for (const raw of input) {
    const q = raw as { kind?: unknown; prompt?: unknown } | null;
    const prompt = typeof q?.prompt === 'string' ? q.prompt.trim() : '';
    if (!prompt) return { ok: false, error: 'Every question needs a prompt' };
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return { ok: false, error: `Prompts are limited to ${MAX_PROMPT_LENGTH} characters` };
    }
    if (!KINDS.includes(q?.kind as SurveyQuestionKind)) return { ok: false, error: 'Invalid question kind' };
    questions.push({ kind: q!.kind as SurveyQuestionKind, prompt });
  }
  return { ok: true, value: questions };
}

export interface SurveyAnswerRow {
  question_id: number;
  answer_number: number | null;
  answer_text: string | null;
}

/** Validates a player's submitted answers (`{ [questionId]: value }`) against the survey's
 *  questions and returns the rows to store. Every question is optional — a missing or blank answer
 *  is simply not stored — but an answer that is present must match its question's kind. */
export function validateSurveyAnswers(
  questions: { id: number; kind: SurveyQuestionKind }[],
  input: unknown,
): Validated<SurveyAnswerRow[]> {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'answers must be an object keyed by question id' };
  }
  const byId = new Map(questions.map((q) => [String(q.id), q]));
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.some(([id]) => !byId.has(id))) return { ok: false, error: 'Unknown question in answers' };

  const rows: SurveyAnswerRow[] = [];
  for (const [id, value] of entries) {
    if (value == null || value === '') continue;
    const q = byId.get(id)!;
    if (q.kind === 'rating') {
      if (!Number.isInteger(value) || (value as number) < RATING_MIN || (value as number) > RATING_MAX) {
        return { ok: false, error: `Ratings must be whole numbers from ${RATING_MIN} to ${RATING_MAX}` };
      }
      rows.push({ question_id: q.id, answer_number: value as number, answer_text: null });
    } else if (q.kind === 'yes_no') {
      if (typeof value !== 'boolean') return { ok: false, error: 'Yes/no answers must be true or false' };
      rows.push({ question_id: q.id, answer_number: value ? 1 : 0, answer_text: null });
    } else {
      if (typeof value !== 'string') return { ok: false, error: 'Text answers must be strings' };
      const text = value.trim();
      if (!text) continue;
      if (text.length > MAX_TEXT_ANSWER_LENGTH) {
        return { ok: false, error: `Text answers are limited to ${MAX_TEXT_ANSWER_LENGTH} characters` };
      }
      rows.push({ question_id: q.id, answer_number: null, answer_text: text });
    }
  }
  return { ok: true, value: rows };
}

export interface SurveyQuestionSummary {
  question_id: number;
  position: number;
  kind: SurveyQuestionKind;
  prompt: string;
  is_core: boolean;
  /** How many responses answered this question. */
  answered: number;
  /** `rating` only — mean of the answers, null when unanswered. */
  average: number | null;
  /** `rating` only — count per rating, index 0 = RATING_MIN. */
  distribution: number[];
  /** `yes_no` only. */
  yes: number;
  no: number;
  /** `text` only — the answers, in submission order, with nothing linking them to a player. */
  texts: string[];
}

/** Rolls raw answers up per question. Takes only the answer values — never who gave them — so the
 *  result is anonymous by construction. */
export function summarizeSurvey(
  questions: { id: number; position: number; kind: SurveyQuestionKind; prompt: string; is_core: boolean }[],
  answers: { question_id: number; answer_number: number | null; answer_text: string | null }[],
): SurveyQuestionSummary[] {
  return [...questions]
    .sort((a, b) => a.position - b.position)
    .map((q) => {
      const mine = answers.filter((a) => a.question_id === q.id);
      const numbers = mine.map((a) => a.answer_number).filter((n): n is number => n != null);
      const distribution = Array.from({ length: RATING_MAX - RATING_MIN + 1 }, () => 0);
      let yes = 0;
      let no = 0;
      if (q.kind === 'rating') for (const n of numbers) distribution[n - RATING_MIN] += 1;
      if (q.kind === 'yes_no') {
        yes = numbers.filter((n) => n === 1).length;
        no = numbers.length - yes;
      }
      return {
        question_id: q.id,
        position: q.position,
        kind: q.kind,
        prompt: q.prompt,
        is_core: q.is_core,
        answered: q.kind === 'text' ? mine.filter((a) => a.answer_text).length : numbers.length,
        average: q.kind === 'rating' && numbers.length > 0 ? numbers.reduce((s, n) => s + n, 0) / numbers.length : null,
        distribution,
        yes,
        no,
        texts: q.kind === 'text' ? mine.map((a) => a.answer_text).filter((t): t is string => !!t) : [],
      };
    });
}

/** Validates a superlative title typed by an admin. */
export function validateSuperlativeTitle(input: unknown): Validated<string> {
  const title = typeof input === 'string' ? input.trim() : '';
  if (!title) return { ok: false, error: 'title is required' };
  if (title.length > MAX_SUPERLATIVE_TITLE_LENGTH) {
    return { ok: false, error: `Titles are limited to ${MAX_SUPERLATIVE_TITLE_LENGTH} characters` };
  }
  return { ok: true, value: title };
}

export interface SuperlativeVoteInput {
  superlative_id: number;
  nominee_player_id: number;
}

/** Validates a ballot (`{ votes: [{ superlative_id, nominee_player_id }] }`) against the season's
 *  superlatives and the players who may be nominated. A ballot may skip superlatives, but names at
 *  most one nominee per superlative. */
export function validateSuperlativeVotes(
  superlativeIds: number[],
  nomineeIds: number[],
  input: unknown,
): Validated<SuperlativeVoteInput[]> {
  if (!Array.isArray(input)) return { ok: false, error: 'votes must be an array' };
  const validSuperlatives = new Set(superlativeIds);
  const validNominees = new Set(nomineeIds);
  const seen = new Set<number>();
  const votes: SuperlativeVoteInput[] = [];
  for (const raw of input) {
    const v = raw as { superlative_id?: unknown; nominee_player_id?: unknown } | null;
    const superlativeId = Number(v?.superlative_id);
    const nomineeId = Number(v?.nominee_player_id);
    if (!validSuperlatives.has(superlativeId)) return { ok: false, error: 'Unknown superlative' };
    if (!validNominees.has(nomineeId)) return { ok: false, error: 'Nominee did not play this season' };
    if (seen.has(superlativeId)) return { ok: false, error: 'One vote per superlative' };
    seen.add(superlativeId);
    votes.push({ superlative_id: superlativeId, nominee_player_id: nomineeId });
  }
  return { ok: true, value: votes };
}

export interface NomineeTally {
  player_id: number;
  votes: number;
}

/** Vote counts per nominee, most votes first (ties by player id so the order is stable). */
export function tallyVotes(nomineeIds: number[]): NomineeTally[] {
  const counts = new Map<number, number>();
  for (const id of nomineeIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()]
    .map(([player_id, votes]) => ({ player_id, votes }))
    .sort((a, b) => b.votes - a.votes || a.player_id - b.player_id);
}
