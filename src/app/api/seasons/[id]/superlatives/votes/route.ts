import { NextRequest, NextResponse } from 'next/server';
import { requireSeasonFeedbackAccess } from '@/lib/feedback-access';
import { getSuperlativePoll } from '@/lib/queries';
import { validateSuperlativeVotes } from '@/lib/survey';

/** Saves the signed-in player's ballot (`{ votes: [{ superlative_id, nominee_player_id }] }`). One
 *  vote per superlative; calling this again while voting is open replaces the ballot — a superlative
 *  left out has its vote cleared. Any player who played the season is a valid nominee, the voter
 *  included. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) return NextResponse.json({ error: 'Invalid season id' }, { status: 400 });

  const access = await requireSeasonFeedbackAccess(seasonId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

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

  if (parsed.value.length > 0) {
    const { error: upsertErr } = await access.supabaseAdmin.from('superlative_votes').upsert(
      parsed.value.map((v) => ({ ...v, voter_player_id: access.playerId, voted_at: new Date().toISOString() })),
      { onConflict: 'superlative_id,voter_player_id' },
    );
    if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  const votedIds = new Set(parsed.value.map((v) => v.superlative_id));
  const clearedIds = poll.superlatives.map((s) => s.id).filter((sid) => !votedIds.has(sid));
  if (clearedIds.length > 0) {
    const { error: clearErr } = await access.supabaseAdmin
      .from('superlative_votes')
      .delete()
      .eq('voter_player_id', access.playerId)
      .in('superlative_id', clearedIds);
    if (clearErr) return NextResponse.json({ error: clearErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
