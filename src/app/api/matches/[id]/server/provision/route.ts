// Provision the DatHost match server for a match (Phase 4). Session-gated (admin or in-match). Fired
// when the 5-stage veto completes. Returns immediately with `provisioning`; the boot + loadmatch
// (~15–20s) runs in `after()` and the client polls `…/server/status` for the connect string.

import { NextRequest, NextResponse, after } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { requireMatchAccess } from '@/lib/match-access';
import { provisionMatchServer } from '@/lib/dathost-lifecycle';

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

  const secret = process.env.MATCHZY_CONFIG_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Server hosting not configured' }, { status: 503 });
  }

  // The DatHost server fetches this URL, so it must be the public deployment origin.
  const base = process.env.APP_BASE_URL ?? req.nextUrl.origin;
  const configUrl = `${base}/api/matches/${matchId}/matchzy-config`;

  // Boot is slow (~15–20s) — run it after the response and let the client poll status.
  after(async () => {
    const supabaseAdmin = getAdminClient();
    try {
      await provisionMatchServer(supabaseAdmin, matchId, configUrl, {
        headerKey: 'X-MatchZy-Token',
        headerValue: secret,
      });
    } catch (err) {
      console.error(`provisionMatchServer(${matchId}) failed:`, err);
    }
  });

  return NextResponse.json({ ok: true, status: 'provisioning' }, { status: 202 });
}
