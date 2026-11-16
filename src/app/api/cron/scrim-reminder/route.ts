import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { notifyScrimNightReminder } from '@/lib/discord-scrim-notify';
import { parseRouteId } from '@/lib/util';

/** Fired once per scrim night by a one-shot Postgres pg_cron job (`schedule_scrim_night_reminder()`),
 *  the way `POST /api/cron/match-reminder` is for a match — see `scheduleScrimNightReminder()` in
 *  `discord-scrim-notify.ts`. Bearer-gated with `CRON_SECRET`; every staleness and idempotency guard
 *  belongs to `notifyScrimNightReminder()`. Always 200s even when the notification no-ops or fails —
 *  nothing retries a one-shot pg_net POST. */
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const raw = (body as { nightId?: unknown } | null)?.nightId;
  const nightId = typeof raw === 'number' || typeof raw === 'string' ? parseRouteId(String(raw)) : null;
  if (nightId === null) {
    return NextResponse.json({ error: 'Invalid nightId' }, { status: 400 });
  }

  await notifyScrimNightReminder(getAdminClient(), nightId);
  return NextResponse.json({ ok: true });
}
