// Re-push the per-match MatchZy config to the live server (RCON `matchzy_loadmatch_url`) without a
// full re-provision. Recovery valve for when a config-set apply (or panel edit) clobbered the loaded
// match config — reasserting `map_sides` (forced side, not knife) and the demo-upload cvars. Loading
// a match config sends MatchZy back to warmup/knife-select, so this is a pre-live action.
//
// Session-gated (admin or in-match). Refuses (409) if another match holds the shared server.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { requireMatchAccess } from '@/lib/match-access';
import { dathostServerId, loadMatch } from '@/lib/dathost';
import { matchzyConfigContext, findServerOccupant } from '@/lib/dathost-lifecycle';
import { parseMatchId } from '@/lib/util';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const matchId = parseMatchId(id);
  if (matchId === null) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }

  const access = await requireMatchAccess(matchId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  // The DatHost server fetches this URL, so it must be the public deployment origin.
  const base = process.env.APP_BASE_URL ?? req.nextUrl.origin;
  const ctx = matchzyConfigContext(base, matchId);
  if (!ctx) {
    return NextResponse.json({ error: 'Server hosting not configured' }, { status: 503 });
  }

  const occupant = await findServerOccupant(getAdminClient(), matchId);
  if (occupant !== null) {
    return NextResponse.json(
      { error: `Another match (#${occupant}) is currently using the server.`, code: 'server_busy' },
      { status: 409 },
    );
  }

  try {
    await loadMatch(dathostServerId(), ctx.configUrl, ctx.configAuth);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load match config' },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
