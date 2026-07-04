// Enable/disable the dathost-cleanup workflow's own triggers (schedule AND workflow_dispatch
// together — GitHub doesn't expose a way to split them; see the "Run now" route for how a manual
// run still works while this is toggled off).

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { setWorkflowEnabled } from '@/lib/gh-dispatch';
import { WORKFLOW_FILE } from '../status/route';

export async function POST(req: NextRequest) {
  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const body = await req.json().catch(() => null);
  if (typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled (boolean) is required' }, { status: 400 });
  }

  const result = await setWorkflowEnabled(WORKFLOW_FILE, body.enabled);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true });
}
