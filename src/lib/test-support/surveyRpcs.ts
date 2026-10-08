/**
 * Test-local fakes for the `replace_survey_questions` and `reset_survey` Postgres RPCs
 * (`supabase/migrations/20261008170000_add_feedback_atomic_rpcs.sql`) — see fakeSupabase.ts's own
 * header comment on why `.rpc()` has no generic in-memory equivalent and needs a per-name fake.
 * Shared by every test that drives a survey route far enough to reach one of these calls.
 */

import type { RpcHandler } from './fakeSupabase';

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
  reset_survey: (args, db) => {
    const surveyId = args.p_survey_id as number;
    for (const survey of db.surveys ?? []) if (survey.id === surveyId) survey.closed_at = new Date().toISOString();
    db.survey_responses = (db.survey_responses ?? []).filter((r) => r.survey_id !== surveyId);
    return null;
  },
};
