// Set how many days must pass between real dathost-cleanup runs (scripts/dathost-cleanup.ts reads
// this as a self-throttle on `schedule`-triggered runs — the workflow's own cron cadence stays
// fixed; see its file for why). Stored as a repo Actions variable, not app/DB state, since this is
// purely about controlling a GitHub Action.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { setRepoVariable } from '@/lib/gh-dispatch';
import { INTERVAL_VARIABLE } from '../status/route';

export async function POST(req: NextRequest) {
  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const body = await req.json().catch(() => null);
  const days = Number(body?.days);
  if (!Number.isInteger(days) || days < 1) {
    return NextResponse.json({ error: 'days must be a positive integer' }, { status: 400 });
  }

  const result = await setRepoVariable(INTERVAL_VARIABLE, String(days));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true });
}
