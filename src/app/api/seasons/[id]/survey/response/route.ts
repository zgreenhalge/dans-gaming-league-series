import { NextRequest, NextResponse } from 'next/server';
import { requireSeasonFeedbackAccess } from '@/lib/feedback-access';
import { getSurveyForSeason, isSurveyOpen } from '@/lib/queries';
import { validateSurveyAnswers } from '@/lib/survey';

/** Saves the signed-in player's survey answers (`{ answers: { [questionId]: value } }`). A player
 *  has one response per survey; calling this again while the survey is open replaces it — answers
 *  left out (or blanked) are cleared. One upsert, so a save is all-or-nothing. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) return NextResponse.json({ error: 'Invalid season id' }, { status: 400 });

  const access = await requireSeasonFeedbackAccess(seasonId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const survey = await getSurveyForSeason(seasonId);
  if (!survey) return NextResponse.json({ error: 'This season has no survey' }, { status: 404 });
  if (!isSurveyOpen(survey)) return NextResponse.json({ error: 'This survey is closed' }, { status: 409 });

  const body = (await req.json().catch(() => null)) as { answers?: unknown } | null;
  const parsed = validateSurveyAnswers(survey.questions, body?.answers);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { error } = await access.supabaseAdmin.from('survey_responses').upsert(
    { survey_id: survey.id, player_id: access.playerId, answers: parsed.value, updated_at: new Date().toISOString() },
    { onConflict: 'survey_id,player_id' },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
