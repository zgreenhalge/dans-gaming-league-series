// Raw stop for the shared DatHost server — no match-state writes (unlike
// /api/matches/[id]/server/teardown, which also updates the owning match's server_state). For the
// admin server console, used independently of any match. A stale `live` match row left behind by a
// raw stop self-corrects on next view via getReconciledServerState — read-only, downgrade-only.

import { NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { dathostServerId, stopServer } from '@/lib/dathost';

export async function POST() {
  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  try {
    await stopServer(dathostServerId());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Stop failed' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
