// The shared shape of the one-shot cron routes a Postgres `pg_cron` job POSTs
// (`schedule_one_shot_post()`): `CRON_SECRET` bearer check, id parse, run the route's work, always 200.
// A route supplies the body key its id travels under and what to do with it.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from './supabase-admin';
import { parseRouteId } from './util';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Handles one `POST /api/cron/*` call: 401 without the `CRON_SECRET` bearer, 400 when `body[idKey]`
 *  is not a positive integer id, else `run(db, id)` and a 200. The 200 holds even when `run` no-ops or
 *  fails: nothing retries a one-shot pg_net POST, so a 5xx would only be noise, and a notifier records
 *  its own failures. */
export async function handleCronPost(
  req: NextRequest,
  idKey: string,
  run: (db: SupabaseClient, id: number) => Promise<void>,
) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const raw = (body as Record<string, unknown> | null)?.[idKey];
  // `parseRouteId()` takes the id as text, so a JSON number or numeric string both parse.
  const id = typeof raw === 'number' || typeof raw === 'string' ? parseRouteId(String(raw)) : null;
  if (id === null) {
    return NextResponse.json({ error: `Invalid ${idKey}` }, { status: 400 });
  }

  await run(getAdminClient(), id);
  return NextResponse.json({ ok: true });
}
