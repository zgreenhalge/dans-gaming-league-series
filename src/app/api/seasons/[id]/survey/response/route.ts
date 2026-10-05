import { NextRequest, NextResponse } from 'next/server';
import { requireSeasonFeedbackAccess } from '@/lib/feedback-access';
import { getSurveyForSeason, isSurveyOpen } from '@/lib/queries';
import { validateSurveyAnswers } from '@/lib/survey';

/** Saves the signed-in player's survey answers (`{ answers: { [questionId]: value } }`). A player
 *  has one response per survey; calling this again while the survey is open edits it — answers left
 *  out (or blanked) are cleared. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) return NextResponse.json({ error: 'Invalid season id' }, { status: 400 });

  const access = await requireSeasonFeedbackAccess(seasonId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const found = await getSurveyForSeason(seasonId);
  if (!found) return NextResponse.json({ error: 'This season has no survey' }, { status: 404 });
  if (!isSurveyOpen(found.survey)) return NextResponse.json({ error: 'This survey is closed' }, { status: 409 });

  const body = (await req.json().catch(() => null)) as { answers?: unknown } | null;
  const parsed = validateSurveyAnswers(found.questions, body?.answers);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { data: response, error: responseErr } = await access.supabaseAdmin
    .from('survey_responses')
    .upsert(
      { survey_id: found.survey.id, player_id: access.playerId, updated_at: new Date().toISOString() },
      { onConflict: 'survey_id,player_id' },
    )
    .select('id')
    .single();
  if (responseErr) return NextResponse.json({ error: responseErr.message }, { status: 500 });

  if (parsed.value.length > 0) {
    const { error: upsertErr } = await access.supabaseAdmin
      .from('survey_answers')
      .upsert(
        parsed.value.map((a) => ({ ...a, response_id: response.id })),
        { onConflict: 'response_id,question_id' },
      );
    if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  const keptIds = new Set(parsed.value.map((a) => a.question_id));
  const clearedIds = found.questions.map((q) => q.id).filter((qid) => !keptIds.has(qid));
  if (clearedIds.length > 0) {
    const { error: clearErr } = await access.supabaseAdmin
      .from('survey_answers')
      .delete()
      .eq('response_id', response.id)
      .in('question_id', clearedIds);
    if (clearErr) return NextResponse.json({ error: clearErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
