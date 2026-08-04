// Tear down the DatHost match server (Phase 4). Session-gated (admin or in-match). Fired when the
// score is reported / demo posted. Reuse model → stops the persistent server, never deletes it.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { requireMatchAccess } from '@/lib/match-access';
import { teardownMatchServer } from '@/lib/dathost-lifecycle';
import { parseMatchId } from '@/lib/util';
import { recordOpsError, clearOpsError } from '@/lib/ops-errors';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const matchId = parseMatchId(id);
  if (matchId === null) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }

  const access = await requireMatchAccess(matchId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  try {
    await teardownMatchServer(getAdminClient(), matchId);
    await clearOpsError(getAdminClient(), 'match', matchId, 'server_teardown');
  } catch (err) {
    await recordOpsError(
      getAdminClient(),
      'match',
      matchId,
      'server_teardown',
      `Server teardown failed: ${err instanceof Error ? err.message : 'Teardown failed'}`,
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Teardown failed' },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, status: 'done' });
}
