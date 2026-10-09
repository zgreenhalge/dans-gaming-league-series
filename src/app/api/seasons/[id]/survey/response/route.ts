import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { requireSeasonFeedbackAccess } from '@/lib/feedback-access';
import { getSurveyForSeason, isSurveyOpen } from '@/lib/queries';
import { validateSurveyAnswers } from '@/lib/survey';
import type { Json } from '@/lib/database.types';

/** Saves the signed-in player's survey answers (`{ answers: { [questionId]: value } }`). A player
 *  has one response per survey; calling this again while the survey is open replaces it — answers
 *  left out (or blanked) are cleared. One `save_survey_response()` RPC call, so a save is
 *  all-or-nothing and lands only while the survey is still open. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireSeasonFeedbackAccess((await params).id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { seasonId } = access;

  const survey = await getSurveyForSeason(seasonId);
  if (!survey) return NextResponse.json({ error: 'This season has no survey' }, { status: 404 });
  if (!isSurveyOpen(survey)) return NextResponse.json({ error: 'This survey is closed' }, { status: 409 });

  const body = (await req.json().catch(() => null)) as { answers?: unknown } | null;
  const parsed = validateSurveyAnswers(survey.questions, body?.answers);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // The open check above gives a friendly early 409; the RPC is the authority, re-checking under a
  // lock so a close or reset landing in between still refuses the write.
  const { data: saved, error } = await getAdminClient().rpc('save_survey_response', {
    p_survey_id: survey.id,
    p_player_id: access.playerId,
    p_answers: parsed.value as Json,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!saved) return NextResponse.json({ error: 'This survey is closed' }, { status: 409 });
  return NextResponse.json({ ok: true });
}
