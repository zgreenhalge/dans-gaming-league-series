// Writes for a season's post-season survey: creating it and replacing its questions. Opening,
// closing and resetting it are in `feedback-lifecycle.ts`; the rules (question drafts, answers) in
// `survey.ts`; reads in `src/lib/queries/feedback.ts`. Every write throws on failure so the calling
// route reports it.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Json } from './database.types';
import { buildSurveyQuestions, type SurveyQuestionDraft } from './survey';

/** Thrown by `createSurvey()` when the season already has a survey, including one another request
 *  created first (the `surveys` unique constraint on season). */
export class SurveyExistsError extends Error {
  constructor() {
    super('This season already has a survey');
    this.name = 'SurveyExistsError';
  }
}

/** Thrown by `replaceSurveyQuestions()` when the survey is open or has a response, so its questions
 *  are fixed. */
export class SurveyLockedError extends Error {
  constructor() {
    super('The survey has opened — its questions can no longer be changed');
    this.name = 'SurveyLockedError';
  }
}

/** Creates a season's survey from `drafts` (see `buildSurveyQuestions()`), open or closed. Returns the
 *  new survey's id. */
export async function createSurvey(db: SupabaseClient, seasonId: number, drafts: SurveyQuestionDraft[], open: boolean): Promise<number> {
  try {
    const { data } = await db
      .from('surveys')
      .insert({
        season_id: seasonId,
        questions: buildSurveyQuestions(drafts) as unknown as Json,
        closed_at: open ? null : new Date().toISOString(),
      })
      .select('id')
      .single()
      .throwOnError();
    return data.id;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new SurveyExistsError();
    throw err;
  }
}

/** Replaces a survey's questions with `drafts`, and opens it when `open` (`replace_survey_questions()`).
 *  One conditional write: the RPC saves only while the survey is closed with no response, and
 *  returns false — nothing written — otherwise, which throws `SurveyLockedError`. */
export async function replaceSurveyQuestions(db: SupabaseClient, surveyId: number, drafts: SurveyQuestionDraft[], open: boolean): Promise<void> {
  const { data: saved } = await db
    .rpc('replace_survey_questions', { p_survey_id: surveyId, p_questions: buildSurveyQuestions(drafts) as unknown as Json, p_open: open })
    .throwOnError();
  if (!saved) throw new SurveyLockedError();
}
