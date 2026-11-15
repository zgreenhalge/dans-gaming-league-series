import { NextRequest, NextResponse } from 'next/server';
import { requireMatchAccess } from '@/lib/match-access';
import { accessDenied } from '@/lib/access-control';
import { internalError } from '@/lib/route-errors';
import { getAdminClient } from '@/lib/supabase-admin';
import { scheduleMatchReminder } from '@/lib/discord-notify';
import { setMatchScheduledAt } from '@/lib/match-day';
import { after } from '@/lib/after';
import { parseRouteId } from '@/lib/util';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const matchId = parseRouteId(id);
  if (matchId === null) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }

  const access = await requireMatchAccess(matchId);
  if (!access.ok) return accessDenied(access);

  const supabaseAdmin = getAdminClient();
  const { data: matchRow } = await supabaseAdmin.from('matches').select('id').eq('id', matchId).maybeSingle();
  if (!matchRow) {
    return NextResponse.json({ error: 'Match not found' }, { status: 404 });
  }

  // A gauntlet pod's two games are paired 30 minutes apart automatically only when their time comes
  // from a linked Discord Scheduled Event (discord-event-sync.ts's podGame2ScheduledAt()) — a human
  // edit here always sets just the one match it targets, Game 1 or Game 2, independently of its pod
  // sibling.
  const body = await req.json().catch(() => null);
  if (!body || !('scheduled_at' in body)) {
    return NextResponse.json({ error: 'Missing scheduled_at' }, { status: 400 });
  }

  const scheduled_at: string | null = body.scheduled_at ?? null;

  if (scheduled_at !== null && isNaN(Date.parse(scheduled_at))) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }

  try {
    await setMatchScheduledAt(supabaseAdmin, matchId, scheduled_at);
  } catch (err) {
    return internalError(err, 'Saving the time failed');
  }

  // Deferred past the response, same as score/route.ts's own post-commit side effects: (re)schedules
  // the 1-hour-out Discord reminder's one-shot pg_cron job for this match's new scheduled_at (or
  // unschedules it if scheduled_at was cleared). Failure here must not fail the request —
  // scheduled_at itself already committed, which is what the caller asked for — and
  // scheduleMatchReminder() never throws, recording any failure to ops_errors itself. A gauntlet
  // pod's two games each get their own reminder, same as any other two matches — a manual edit never
  // ripples from one to the other.
  after(() => scheduleMatchReminder(supabaseAdmin, matchId, scheduled_at));

  return NextResponse.json({ ok: true });
}
