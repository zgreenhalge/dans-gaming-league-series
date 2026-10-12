import { NextRequest } from 'next/server';
import { requireSeasonFeedbackAccess } from '@/lib/feedback-access';
import { saveFeedbackAnswers, SURVEY_LIFECYCLE } from '@/lib/feedback-lifecycle';
import { accessDenied } from '@/lib/access-control';

/** Saves the signed-in player's survey answers (`{ answers: { [questionId]: value } }`). A player
 *  has one response per survey; calling this again while the survey is open replaces it — answers
 *  left out (or blanked) are cleared. One `save_survey_response()` RPC call, so a save is
 *  all-or-nothing and lands only while the survey is still open. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireSeasonFeedbackAccess((await params).id);
  if (!access.ok) return accessDenied(access);
  return saveFeedbackAnswers(SURVEY_LIFECYCLE, access, req);
}
