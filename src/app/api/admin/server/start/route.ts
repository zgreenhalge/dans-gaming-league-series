// Raw start for the shared DatHost server — no match-state writes (unlike match provisioning). For
// the admin server console, used independently of any match.

import { NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { dathostServerId, startServer } from '@/lib/dathost';

export async function POST() {
  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  try {
    await startServer(dathostServerId());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Start failed' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
