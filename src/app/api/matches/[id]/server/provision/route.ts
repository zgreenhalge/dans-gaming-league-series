// Provision the DatHost match server for a match (Phase 4). Session-gated (admin or in-match). Fired
// when the 5-stage veto completes. Returns immediately with `provisioning`; the boot + loadmatch
// (~15–20s) runs in `after()` and the client polls `…/server/status` for the connect string.

import { NextRequest, NextResponse, after } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { requireMatchAccess } from '@/lib/match-access';
import { provisionMatchServer, matchzyConfigContext } from '@/lib/dathost-lifecycle';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const matchId = Number(id);
  if (!Number.isInteger(matchId) || matchId <= 0) {
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

  // Boot is slow (~15–20s) — run it after the response and let the client subscribe for updates.
  after(async () => {
    try {
      await provisionMatchServer(getAdminClient(), matchId, ctx.configUrl, ctx.configAuth);
    } catch (err) {
      console.error(`provisionMatchServer(${matchId}) failed:`, err);
    }
  });

  return NextResponse.json({ ok: true, status: 'provisioning' }, { status: 202 });
}
