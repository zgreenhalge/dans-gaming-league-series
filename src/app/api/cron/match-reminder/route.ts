import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { notifyMatchReminder } from '@/lib/discord-notify';

/** Fired once per match by a one-shot Postgres pg_cron job (`schedule_match_reminder()`), not by
 *  Vercel's own cron (which only issues `GET` and is registered in `vercel.json` — this route
 *  deliberately isn't) — see `discord-notify.ts`'s `notifyMatchReminder()` docstring for the full
 *  scheduling chain. Bearer-gated the same way `GET /api/cron/refresh-steam` is; kept thin
 *  (auth + body parsing only) since every idempotency/staleness guard belongs to
 *  `notifyMatchReminder()`, not this route. Always 200s even when the notification itself no-ops or
 *  fails — nothing on the calling end retries a one-shot pg_net POST, so a 5xx here would just be
 *  noise; a real failure is recorded to ops_errors instead. */
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const matchId = Number((body as { matchId?: unknown } | null)?.matchId);
  if (!Number.isFinite(matchId)) {
    return NextResponse.json({ error: 'Invalid matchId' }, { status: 400 });
  }

  await notifyMatchReminder(getAdminClient(), matchId);
  return NextResponse.json({ ok: true });
}
