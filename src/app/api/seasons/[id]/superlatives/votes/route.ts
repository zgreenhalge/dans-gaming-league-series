import { NextRequest, NextResponse } from 'next/server';
import { requireSeasonFeedbackAccess, requireSeasonFeedbackAdmin } from '@/lib/feedback-access';
import { resetFeedback, saveFeedbackAnswers, SUPERLATIVES_LIFECYCLE } from '@/lib/feedback-lifecycle';

/** Saves the signed-in player's ballot (`{ votes: [{ superlative_id, nominee_player_id }] }`). One
 *  vote per superlative; calling this again while voting is open replaces the ballot — a superlative
 *  left out has its vote cleared. Any player who played the season is a valid nominee, the voter
 *  included. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireSeasonFeedbackAccess((await params).id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  return saveFeedbackAnswers(SUPERLATIVES_LIFECYCLE, access, req);
}

/** Admin reset: closes voting and deletes every vote cast for the season's superlatives, as one
 *  `reset_superlative_votes()` RPC call (all-or-nothing). The superlatives themselves are kept, and
 *  — with no votes and voting closed — the list is editable again. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireSeasonFeedbackAdmin((await params).id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { seasonId } = access;

  return resetFeedback(SUPERLATIVES_LIFECYCLE, seasonId);
}
