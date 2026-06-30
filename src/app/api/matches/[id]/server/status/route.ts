// Server status for the in-match UI to poll (Phase 4). Session-gated (admin or in-match). Returns the
// server-state machine + connect string so the client can show "starting…" → join/connect links.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { requireMatchAccess } from '@/lib/match-access';
import { parseMatchId } from '@/lib/util';

export async function GET(
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

  const { data, error } = await getAdminClient()
    .from('matches')
    .select('server_state, connect_string, server_started_at')
    .eq('id', matchId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const row = (data ?? {}) as {
    server_state?: string | null;
    connect_string?: string | null;
    server_started_at?: string | null;
  };
  return NextResponse.json({
    serverState: row.server_state ?? 'idle',
    connectString: row.connect_string ?? null,
    serverStartedAt: row.server_started_at ?? null,
  });
}
