import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { requireSeasonFeedbackAccess, requireSeasonFeedbackAdmin } from '@/lib/feedback-access';
import { getSuperlativePoll, hasSuperlativePoll } from '@/lib/queries';
import { validateSuperlativeVotes } from '@/lib/survey';

/** Saves the signed-in player's ballot (`{ votes: [{ superlative_id, nominee_player_id }] }`). One
 *  vote per superlative; calling this again while voting is open replaces the ballot — a superlative
 *  left out has its vote cleared. Any player who played the season is a valid nominee, the voter
 *  included. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireSeasonFeedbackAccess((await params).id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { seasonId } = access;

  const poll = await getSuperlativePoll(seasonId);
  if (!poll || poll.superlatives.length === 0) return NextResponse.json({ error: 'No superlatives vote for this season' }, { status: 404 });
  if (!poll.isOpen) return NextResponse.json({ error: 'Voting is closed' }, { status: 409 });

  const body = (await req.json().catch(() => null)) as { votes?: unknown } | null;
  const parsed = validateSuperlativeVotes(
    poll.superlatives.map((s) => s.id),
    access.eligible.map((p) => p.player_id),
    body?.votes,
  );
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // The open check above gives a friendly early 409; the RPC is the authority, re-checking under a
  // lock so a close or reset landing in between still refuses the write.
  const { data: saved, error } = await getAdminClient().rpc('replace_superlative_votes', {
    p_season_id: seasonId,
    p_voter_player_id: access.playerId,
    p_superlative_ids: poll.superlatives.map((s) => s.id),
    p_votes: parsed.value,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!saved) return NextResponse.json({ error: 'Voting is closed' }, { status: 409 });

  return NextResponse.json({ ok: true });
}

/** Admin reset: closes voting and deletes every vote cast for the season's superlatives, as one
 *  `reset_superlative_votes()` RPC call (all-or-nothing). The superlatives themselves are kept, and
 *  — with no votes and voting closed — the list is editable again. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireSeasonFeedbackAdmin((await params).id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { seasonId } = access;

  if (!(await hasSuperlativePoll(seasonId))) return NextResponse.json({ error: 'No superlatives vote for this season' }, { status: 404 });

  const { error } = await getAdminClient().rpc('reset_superlative_votes', { p_season_id: seasonId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
