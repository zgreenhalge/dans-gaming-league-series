// Admin lifecycle handlers shared by the survey and superlatives routes: open/close and reset. A
// route supplies a `FeedbackLifecycle` describing how its form is found and written, and the
// handler runs the identical sequence for both — look the form up (404 if the season has none),
// apply the change, map a failed write to a 500 — so a new lifecycle action is written once here
// and gets a one-method adapter per form. The caller has already passed `requireSeasonFeedbackAdmin()`.

import { NextResponse } from 'next/server';
import { getAdminClient } from './supabase-admin';
import { getSuperlativePoll, getSurveyForSeason } from './queries';
import type { SuperlativePoll, Survey } from './queries';

/** The write outcome of a lifecycle step: null on success, else the database error. */
type WriteResult = PromiseLike<{ error: { message: string } | null }>;

export interface FeedbackLifecycle<Form> {
  /** The 404 message when the season has no form. */
  missing: string;
  find(seasonId: number): Promise<Form | null>;
  /** A reason this form can't be opened yet (answered 400), or null. */
  cannotOpen?(form: Form): string | null;
  setOpen(seasonId: number, form: Form, open: boolean): WriteResult;
  /** Closes the form and deletes every answer, keeping its questions or superlatives. */
  reset(seasonId: number, form: Form): WriteResult;
}

export const SURVEY_LIFECYCLE: FeedbackLifecycle<Survey> = {
  missing: 'This season has no survey',
  find: getSurveyForSeason,
  setOpen: (_seasonId, survey, open) =>
    getAdminClient().from('surveys').update({ closed_at: open ? null : new Date().toISOString() }).eq('id', survey.id),
  reset: (_seasonId, survey) => getAdminClient().rpc('reset_survey', { p_survey_id: survey.id }),
};

export const SUPERLATIVES_LIFECYCLE: FeedbackLifecycle<SuperlativePoll> = {
  missing: 'No superlatives vote for this season',
  find: getSuperlativePoll,
  cannotOpen: (poll) => (poll.superlatives.length === 0 ? 'Add a superlative before opening the vote' : null),
  setOpen: (seasonId, _poll, open) =>
    getAdminClient().from('superlative_polls').update({ is_open: open }).eq('season_id', seasonId),
  reset: (seasonId) => getAdminClient().rpc('reset_superlative_votes', { p_season_id: seasonId }),
};

function failure(error: { message: string }) {
  return NextResponse.json({ error: error.message }, { status: 500 });
}

/** Opens or closes a season's form. Closing keeps every answer; players just can no longer submit or
 *  edit. */
export async function setFeedbackOpen<Form>(lifecycle: FeedbackLifecycle<Form>, seasonId: number, open: boolean) {
  const form = await lifecycle.find(seasonId);
  if (!form) return NextResponse.json({ error: lifecycle.missing }, { status: 404 });
  const blocked = open ? lifecycle.cannotOpen?.(form) : null;
  if (blocked) return NextResponse.json({ error: blocked }, { status: 400 });

  const { error } = await lifecycle.setOpen(seasonId, form, open);
  return error ? failure(error) : NextResponse.json({ ok: true });
}

/** Admin reset: closes a season's form and deletes every answer as one all-or-nothing RPC call. The
 *  questions or superlatives are kept and — with no answers and the form closed — editable again. */
export async function resetFeedback<Form>(lifecycle: FeedbackLifecycle<Form>, seasonId: number) {
  const form = await lifecycle.find(seasonId);
  if (!form) return NextResponse.json({ error: lifecycle.missing }, { status: 404 });

  const { error } = await lifecycle.reset(seasonId, form);
  return error ? failure(error) : NextResponse.json({ ok: true });
}
