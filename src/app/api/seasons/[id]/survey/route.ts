import { NextRequest, NextResponse } from 'next/server';
import { requireSeasonFeedbackAdmin } from '@/lib/feedback-access';
import { getSurveyForSeason } from '@/lib/queries';
import type { Json } from '@/lib/database.types';
import { buildSurveyQuestions, validateQuestionDrafts } from '@/lib/survey';

/** Opens a season's post-season survey with the admin's question order: custom questions and
 *  `{ core: index }` references in display order, any core questions left out following them. One
 *  survey per season; it starts open, and its questions are fixed from then on. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireSeasonFeedbackAdmin((await params).id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { seasonId } = access;

  const body = (await req.json().catch(() => null)) as { questions?: unknown } | null;
  const drafts = validateQuestionDrafts(body?.questions);
  if (!drafts.ok) return NextResponse.json({ error: drafts.error }, { status: 400 });

  if (await getSurveyForSeason(seasonId)) {
    return NextResponse.json({ error: 'This season already has a survey' }, { status: 409 });
  }

  const { data: survey, error } = await access.supabaseAdmin
    .from('surveys')
    .insert({ season_id: seasonId, questions: buildSurveyQuestions(drafts.value) as unknown as Json })
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
