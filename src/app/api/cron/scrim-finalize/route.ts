import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { finalizeEndedScrimNights } from '@/lib/discord-scrim-notify';

/** Fired every five minutes by a recurring Postgres pg_cron job (`scrim_night_finalize`). A scrim night
 *  that goes idle ends on the clock with no write to react to, so this turns the Discord message of
 *  each such night to its final standings (`finalizeEndedScrimNights()`). Bearer-gated with
 *  `CRON_SECRET`, like `POST /api/cron/scrim-reminder`; always 200s, since a failure is logged and the
 *  next run tries again. */
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  await finalizeEndedScrimNights(getAdminClient());
  return NextResponse.json({ ok: true });
}
