import { NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { scheduleMatchReminder } from '@/lib/discord-notify';
import { parseMatchId } from '@/lib/util';

/** Admin "Retry" action (`retryEndpointFor()`, `OpsErrorList.tsx`) on a live
 *  `discord_schedule_reminder`/`discord_notify_reminder` ops-errors row — re-runs
 *  `scheduleMatchReminder()` against the match's current `scheduled_at`, the same call
 *  `PATCH /api/matches/[id]/schedule` and `discord-event-sync.ts` make on every write. Safe to fire
 *  blind: `schedule_match_reminder()` always resets `match_discord_state.reminder_sent_at` before
 *  doing anything else, so a stale claim left by an earlier failed delivery attempt can't suppress
 *  this retry, and a reminder window that's already passed fires immediately rather than silently
 *  scheduling for the past. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const { id } = await params;
  const matchId = parseMatchId(id);
  if (matchId === null) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }

  const supabaseAdmin = getAdminClient();
  const { data: match, error } = await supabaseAdmin
    .from('matches')
    .select('scheduled_at')
    .eq('id', matchId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!match) {
    return NextResponse.json({ error: 'Match not found' }, { status: 404 });
  }

  await scheduleMatchReminder(supabaseAdmin, matchId, match.scheduled_at);
  return NextResponse.json({ ok: true });
}
