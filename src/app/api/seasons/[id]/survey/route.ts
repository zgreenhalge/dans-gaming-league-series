import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { requireSeasonFeedbackAdmin } from '@/lib/feedback-access';
import { resetFeedback, setFeedbackOpen, SURVEY_LIFECYCLE } from '@/lib/feedback-lifecycle';
import { getSurveyForSeason } from '@/lib/queries';
import { validateQuestionDrafts, type SurveyQuestionDraft } from '@/lib/survey';
import { createSurvey, replaceSurveyQuestions, SurveyExistsError, SurveyLockedError } from '@/lib/survey-writes';
import { accessDenied } from '@/lib/access-control';
import { internalError } from '@/lib/route-errors';

/** Reads the `{ questions, open? }` body shared by POST and PUT. */
async function readQuestionsBody(
  req: NextRequest,
): Promise<{ ok: true; drafts: SurveyQuestionDraft[]; open: boolean | undefined } | { ok: false; error: string }> {
  const body = (await req.json().catch(() => null)) as { questions?: unknown; open?: unknown } | null;
  const drafts = validateQuestionDrafts(body?.questions);
  if (!drafts.ok) return drafts;
  if (body?.open !== undefined && typeof body.open !== 'boolean') return { ok: false, error: 'open must be a boolean' };
  return { ok: true, drafts: drafts.value, open: body?.open };
}

/** Creates a season's post-season survey with the admin's question order: custom questions and
 *  `{ core: index }` references in display order, any core questions left out following them. One
 *  survey per season; it starts open unless `{ open: false }` is sent, which saves it closed. Its
 *  questions are fixed while it is open or has responses. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireSeasonFeedbackAdmin((await params).id);
  if (!access.ok) return accessDenied(access);
  const { seasonId } = access;

  const body = await readQuestionsBody(req);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });

  if (await getSurveyForSeason(seasonId)) {
    return NextResponse.json({ error: 'This season already has a survey' }, { status: 409 });
  }

  try {
    const surveyId = await createSurvey(getAdminClient(), seasonId, body.drafts, body.open !== false);
    return NextResponse.json({ ok: true, survey_id: surveyId }, { status: 201 });
  } catch (err) {
    if (err instanceof SurveyExistsError) return NextResponse.json({ error: err.message }, { status: 409 });
    return internalError(err, 'Creating the survey failed');
  }
}

/** Closes or reopens a season's survey (`{ open: boolean }`). Closing keeps every answer; players
 *  just can no longer submit or edit. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireSeasonFeedbackAdmin((await params).id);
  if (!access.ok) return accessDenied(access);
  const { seasonId } = access;

  const body = (await req.json().catch(() => null)) as { open?: unknown } | null;
  if (typeof body?.open !== 'boolean') return NextResponse.json({ error: 'open must be a boolean' }, { status: 400 });

  return setFeedbackOpen(SURVEY_LIFECYCLE, seasonId, body.open);
}

/** Replaces a survey's questions (`{ questions, open? }`, same shape as the POST; `open: true` also
 *  opens the survey). Refused (409) while the survey is open or has any response. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireSeasonFeedbackAdmin((await params).id);
  if (!access.ok) return accessDenied(access);

  const body = await readQuestionsBody(req);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });

  const existing = await getSurveyForSeason(access.seasonId);
  if (!existing) return NextResponse.json({ error: 'This season has no survey' }, { status: 404 });

  try {
    await replaceSurveyQuestions(getAdminClient(), existing.id, body.drafts, body.open === true);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SurveyLockedError) return NextResponse.json({ error: err.message }, { status: 409 });
    return internalError(err, 'Saving the questions failed');
  }
}

/** Admin reset: closes the survey and deletes every response, as one `reset_survey()` RPC call
 *  (all-or-nothing). The questions are kept, and — with no responses and the survey closed — can be
 *  edited again. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireSeasonFeedbackAdmin((await params).id);
  if (!access.ok) return accessDenied(access);

  return resetFeedback(SURVEY_LIFECYCLE, access.seasonId);
}
