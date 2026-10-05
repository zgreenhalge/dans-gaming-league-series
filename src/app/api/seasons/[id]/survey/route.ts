import { NextRequest, NextResponse } from 'next/server';
import { requireSeasonFeedbackAdmin } from '@/lib/feedback-access';
import { getSurveyForSeason } from '@/lib/queries';
import { buildSurveyQuestionRows, validateCustomQuestions } from '@/lib/survey';

/** Sends a season's post-season survey: the admin's custom questions followed by the core ones.
 *  One survey per season; it starts open. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) return NextResponse.json({ error: 'Invalid season id' }, { status: 400 });

  const access = await requireSeasonFeedbackAdmin(seasonId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const body = (await req.json().catch(() => null)) as { questions?: unknown } | null;
  const custom = validateCustomQuestions(body?.questions);
  if (!custom.ok) return NextResponse.json({ error: custom.error }, { status: 400 });

  if (await getSurveyForSeason(seasonId)) {
    return NextResponse.json({ error: 'This season already has a survey' }, { status: 409 });
  }

  const { data: survey, error: surveyErr } = await access.supabaseAdmin
    .from('surveys')
    .insert({ season_id: seasonId })
    .select('id')
    .single();
  if (surveyErr) {
    const taken = (surveyErr as { code?: string }).code === '23505';
    return NextResponse.json(
      { error: taken ? 'This season already has a survey' : surveyErr.message },
      { status: taken ? 409 : 500 },
    );
  }

  const rows = buildSurveyQuestionRows(custom.value).map((q) => ({ ...q, survey_id: survey.id }));
  const { error: questionsErr } = await access.supabaseAdmin.from('survey_questions').insert(rows);
  if (questionsErr) {
    // A survey with no questions is unusable — remove it so the admin can retry cleanly.
    const { error: cleanupErr } = await access.supabaseAdmin.from('surveys').delete().eq('id', survey.id);
    const detail = cleanupErr ? ` (cleanup also failed: ${cleanupErr.message})` : '';
    return NextResponse.json({ error: `${questionsErr.message}${detail}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, survey_id: survey.id }, { status: 201 });
}

/** Closes or reopens a season's survey (`{ open: boolean }`). Closing keeps every answer; players
 *  just can no longer submit or edit. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) return NextResponse.json({ error: 'Invalid season id' }, { status: 400 });

  const access = await requireSeasonFeedbackAdmin(seasonId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const body = (await req.json().catch(() => null)) as { open?: unknown } | null;
  if (typeof body?.open !== 'boolean') return NextResponse.json({ error: 'open must be a boolean' }, { status: 400 });

  const existing = await getSurveyForSeason(seasonId);
  if (!existing) return NextResponse.json({ error: 'This season has no survey' }, { status: 404 });

  const { error } = await access.supabaseAdmin
    .from('surveys')
    .update({ closed_at: body.open ? null : new Date().toISOString() })
    .eq('id', existing.survey.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
