/**
 * Test-local fakes for the survey Postgres RPCs (`replace_survey_questions`, `save_survey_response`,
 * `reset_survey`; see `supabase/migrations/`) — see fakeSupabase.ts's own
 * header comment on why `.rpc()` has no generic in-memory equivalent and needs a per-name fake.
 * Shared by every test that drives a survey route far enough to reach one of these calls.
 */

import { nextId, type RpcHandler } from './fakeSupabase';

export const surveyRpcs: Record<string, RpcHandler> = {
  replace_survey_questions: (args, db) => {
    const surveyId = args.p_survey_id as number;
    const survey = (db.surveys ?? []).find((s) => s.id === surveyId);
    const hasResponse = (db.survey_responses ?? []).some((r) => r.survey_id === surveyId);
    if (!survey || survey.closed_at == null || hasResponse) return false;
    survey.questions = args.p_questions;
    if (args.p_open === true) survey.closed_at = null;
    return true;
  },
  save_survey_response: (args, db) => {
    const surveyId = args.p_survey_id as number;
    const playerId = args.p_player_id as number;
    const survey = (db.surveys ?? []).find((s) => s.id === surveyId);
    if (!survey || survey.closed_at != null) return false;
    db.survey_responses = db.survey_responses ?? [];
    const existing = db.survey_responses.find((r) => r.survey_id === surveyId && r.player_id === playerId);
    const now = new Date().toISOString();
    if (existing) {
      existing.answers = args.p_answers;
      existing.updated_at = now;
    } else {
      db.survey_responses.push({ id: nextId(db.survey_responses), survey_id: surveyId, player_id: playerId, answers: args.p_answers, submitted_at: now, updated_at: now });
    }
    return true;
  },
  reset_survey: (args, db) => {
    const surveyId = args.p_survey_id as number;
    for (const survey of db.surveys ?? []) if (survey.id === surveyId) survey.closed_at = new Date().toISOString();
    db.survey_responses = (db.survey_responses ?? []).filter((r) => r.survey_id !== surveyId);
    return null;
  },
};
