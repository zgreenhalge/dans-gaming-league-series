import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { getAdminClient } from '@/lib/supabase-admin';
import { recordOpsError } from '@/lib/ops-errors';

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
  if (isGauntlet) {
    return NextResponse.json({ error: 'Cannot schedule gauntlet matches' }, { status: 403 });
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

  // Best-effort: (re)schedules the 1-hour-out Discord reminder's one-shot pg_cron job for this
  // match's new scheduled_at (or unschedules it if scheduled_at was cleared). Failure here must not
  // fail the request — scheduled_at itself already committed, which is what the caller asked for.
  // Wrapped in try/catch, not just an `.error` check, since an RPC call can also throw outright
  // (a malformed args shape, a client-level error) rather than resolving with one.
  try {
    const { error: rpcError } = await supabaseAdmin.rpc('schedule_match_reminder', {
      p_match_id: matchId,
      p_scheduled_at: scheduled_at,
    });
    if (rpcError) {
      await recordOpsError(supabaseAdmin, 'match', matchId, 'discord_notify_reminder', `Failed to schedule reminder: ${rpcError.message}`);
    }
  } catch (e) {
    await recordOpsError(supabaseAdmin, 'match', matchId, 'discord_notify_reminder', `Failed to schedule reminder: ${(e as Error).message}`);
  }

  return NextResponse.json({ ok: true });
}
