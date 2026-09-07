import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { getAdminClient } from '@/lib/supabase-admin';
import { scheduleMatchReminder } from '@/lib/discord-notify';
import { getGauntletPodForMatch } from '@/lib/queries';
import { after } from '@/lib/after';

/** Both games in a gauntlet pod share the same 4 players, so they can never actually be played at
 * once — this is the fixed gap between them once a pod's start time is set. */
const POD_GAME_GAP_MS = 30 * 60 * 1000;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session?.user?.playerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseAdmin = getAdminClient();
  const { id } = await params;
  const matchId = Number(id);
  if (!Number.isFinite(matchId)) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }

  const playerId = session.user.playerId;

  // Resolve match, player admin status, and whether the player is in this match
  const [{ data: matchRow }, { data: playerRow }, { data: statRow }] = await Promise.all([
    supabaseAdmin
      .from('matches')
      .select('week_id, weeks(seasons(is_gauntlet))')
      .eq('id', matchId)
      .maybeSingle(),
    supabaseAdmin.from('players').select('is_admin').eq('id', playerId).maybeSingle(),
    supabaseAdmin
      .from('player_match_stats')
      .select('player_id')
      .eq('match_id', matchId)
      .eq('player_id', playerId)
      .maybeSingle(),
  ]);

  if (!matchRow) {
    return NextResponse.json({ error: 'Match not found' }, { status: 404 });
  }

  const isAdmin = !!(playerRow as { is_admin?: boolean } | null)?.is_admin;
  const isInMatch = statRow !== null;
  if (!isAdmin && !isInMatch) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const isGauntlet =
    (matchRow as { weeks?: { seasons?: { is_gauntlet?: boolean } } } | null)
      ?.weeks?.seasons?.is_gauntlet ?? false;

  // A gauntlet match is always half of a pod — the pod, not the individual game, is what gets
  // scheduled (see POD_GAME_GAP_MS above). Game 1's id is the one canonical "pod start" time to
  // write through; Game 2 always follows 30 minutes later and is never independently editable, so
  // editing from Game 2's own page/row is refused rather than silently reinterpreting its value.
  let gauntletGame2Id: number | null = null;
  if (isGauntlet) {
    const pod = await getGauntletPodForMatch(matchId);
    if (!pod) {
      return NextResponse.json({ error: 'Gauntlet pod not found for this match' }, { status: 404 });
    }
    if (matchId !== pod.match1_id) {
      return NextResponse.json(
        { error: "Schedule this pod's Game 1 match instead — Game 2 always follows 30 minutes later" },
        { status: 400 },
      );
    }
    gauntletGame2Id = pod.match2_id;
  }

  const body = await req.json().catch(() => null);
  if (!body || !('scheduled_at' in body)) {
    return NextResponse.json({ error: 'Missing scheduled_at' }, { status: 400 });
  }

  const scheduled_at: string | null = body.scheduled_at ?? null;

  if (scheduled_at !== null && isNaN(Date.parse(scheduled_at))) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('matches')
    .update({ scheduled_at })
    .eq('id', matchId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Game 2's time is fully derived from Game 1's — a separate write, not a transaction, but Game 1's
  // own write above already committed by the time this runs, so a failure here is reported as its
  // own 500 (never swallowed) rather than left to look like the whole PATCH silently no-op'd; retrying
  // the same request is safe since both writes are idempotent.
  if (gauntletGame2Id != null) {
    const game2ScheduledAt = scheduled_at
      ? new Date(new Date(scheduled_at).getTime() + POD_GAME_GAP_MS).toISOString()
      : null;
    const { error: game2Error } = await supabaseAdmin
      .from('matches')
      .update({ scheduled_at: game2ScheduledAt })
      .eq('id', gauntletGame2Id);
    if (game2Error) {
      return NextResponse.json({ error: `Game 1 scheduled, but Game 2 failed: ${game2Error.message}` }, { status: 500 });
    }
  }

  // Deferred past the response, same as score/route.ts's own post-commit side effects: (re)schedules
  // the 1-hour-out Discord reminder's one-shot pg_cron job for this match's new scheduled_at (or
  // unschedules it if scheduled_at was cleared). Failure here must not fail the request —
  // scheduled_at itself already committed, which is what the caller asked for — and
  // scheduleMatchReminder() never throws, recording any failure to ops_errors itself. Only Game 1
  // (or a non-gauntlet match) ever gets a reminder scheduled — one reminder per pod, not two.
  after(() => scheduleMatchReminder(supabaseAdmin, matchId, scheduled_at));

  return NextResponse.json({ ok: true });
}
