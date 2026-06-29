// Tear down the DatHost match server (Phase 4). Session-gated (admin or in-match). Fired when the
// score is reported / demo posted. Reuse model → stops the persistent server, never deletes it.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { requireMatchAccess } from '@/lib/match-access';
import { teardownMatchServer } from '@/lib/dathost-lifecycle';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const matchId = Number(id);
  if (!Number.isInteger(matchId) || matchId <= 0) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }

  const access = await requireMatchAccess(matchId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  try {
    await teardownMatchServer(getAdminClient(), matchId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Teardown failed' },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, status: 'done' });
}
