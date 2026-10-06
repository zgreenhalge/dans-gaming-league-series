import { NextRequest, NextResponse } from 'next/server';
import { requireSeasonFeedbackAdmin } from '@/lib/feedback-access';
import { getSurveyForSeason, isSurveyLocked } from '@/lib/queries';
import type { Json } from '@/lib/database.types';
import { buildSurveyQuestions, validateQuestionDrafts } from '@/lib/survey';

/** Creates a season's post-season survey with the admin's question order: custom questions and
 *  `{ core: index }` references in display order, any core questions left out following them. One
 *  survey per season; it starts open unless `{ open: false }` is sent, which saves it closed. Its
 *  questions are fixed while it is open or has responses. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireSeasonFeedbackAdmin((await params).id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { seasonId } = access;

  const body = (await req.json().catch(() => null)) as { questions?: unknown; open?: unknown } | null;
  const drafts = validateQuestionDrafts(body?.questions);
  if (!drafts.ok) return NextResponse.json({ error: drafts.error }, { status: 400 });
  if (body?.open !== undefined && typeof body.open !== 'boolean') {
    return NextResponse.json({ error: 'open must be a boolean' }, { status: 400 });
  }

  if (await getSurveyForSeason(seasonId)) {
    return NextResponse.json({ error: 'This season already has a survey' }, { status: 409 });
  }

  const { data: survey, error } = await access.supabaseAdmin
    .from('surveys')
    .insert({
      season_id: seasonId,
      questions: buildSurveyQuestions(drafts.value) as unknown as Json,
      closed_at: body?.open === false ? new Date().toISOString() : null,
    })
    .select('id')
    .single();
  if (error) {
    const taken = (error as { code?: string }).code === '23505';
    return NextResponse.json(
      { error: taken ? 'This season already has a survey' : error.message },
      { status: taken ? 409 : 500 },
    );
  }

  return NextResponse.json({ ok: true, survey_id: survey.id }, { status: 201 });
}

/** Closes or reopens a season's survey (`{ open: boolean }`). Closing keeps every answer; players
 *  just can no longer submit or edit. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireSeasonFeedbackAdmin((await params).id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { seasonId } = access;

  const body = (await req.json().catch(() => null)) as { open?: unknown } | null;
  if (typeof body?.open !== 'boolean') return NextResponse.json({ error: 'open must be a boolean' }, { status: 400 });

  const existing = await getSurveyForSeason(seasonId);
  if (!existing) return NextResponse.json({ error: 'This season has no survey' }, { status: 404 });

  const { error } = await access.supabaseAdmin
    .from('surveys')
    .update({ closed_at: body.open ? null : new Date().toISOString() })
    .eq('id', existing.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** Replaces a survey's questions (`{ questions, open? }`, same shape as the POST; `open: true` also
 *  opens the survey). Refused (409) while the survey is open or has any response. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireSeasonFeedbackAdmin((await params).id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const body = (await req.json().catch(() => null)) as { questions?: unknown; open?: unknown } | null;
  const drafts = validateQuestionDrafts(body?.questions);
  if (!drafts.ok) return NextResponse.json({ error: drafts.error }, { status: 400 });
  if (body?.open !== undefined && typeof body.open !== 'boolean') {
    return NextResponse.json({ error: 'open must be a boolean' }, { status: 400 });
  }

  const existing = await getSurveyForSeason(access.seasonId);
  if (!existing) return NextResponse.json({ error: 'This season has no survey' }, { status: 404 });
  if (await isSurveyLocked(existing)) {
    return NextResponse.json({ error: 'The survey has opened — its questions can no longer be changed' }, { status: 409 });
  }

  const { error } = await access.supabaseAdmin
    .from('surveys')
    .update({
      questions: buildSurveyQuestions(drafts.value) as unknown as Json,
      ...(body?.open === true && { closed_at: null }),
    })
    .eq('id', existing.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** Admin reset: closes the survey and deletes every response. The questions are kept, and — with no
 *  responses and the survey closed — can be edited again. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireSeasonFeedbackAdmin((await params).id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const existing = await getSurveyForSeason(access.seasonId);
  if (!existing) return NextResponse.json({ error: 'This season has no survey' }, { status: 404 });

  // Close first: if the delete then fails, no new responses can land while the admin retries.
  const { error: closeErr } = await access.supabaseAdmin
    .from('surveys')
    .update({ closed_at: new Date().toISOString() })
    .eq('id', existing.id);
  if (closeErr) return NextResponse.json({ error: closeErr.message }, { status: 500 });

  const { error: deleteErr } = await access.supabaseAdmin.from('survey_responses').delete().eq('survey_id', existing.id);
  if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
