// Machine-authenticated MatchZy config endpoint — the `matchzy_loadmatch_url` target. The DatHost
// server fetches this (with `X-MatchZy-Token`) to load the per-match config. NOT session-gated: it's
// called by the game server, not a browser.
//
// Auth: shared secret in `X-MatchZy-Token`, constant-time compared against `MATCHZY_CONFIG_SECRET`.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { buildMatchzyConfig } from '@/lib/matchzy';
import { resolveMapWorkshopId } from '@/lib/dathost-lifecycle';
import { machineSecretGuard } from '@/lib/machine-auth';
import { parseMatchId } from '@/lib/util';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = machineSecretGuard(
    req.headers.get('x-matchzy-token'),
    process.env.MATCHZY_CONFIG_SECRET,
    'MatchZy config not configured',
  );
  if (denied) return denied;

  const { id } = await params;
  const matchId = parseMatchId(id);
  if (matchId === null) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }

  const supabaseAdmin = getAdminClient();
  // Prefer the Steam workshop id for the maplist (the server force-loads it via cs2_settings);
  // buildMatchzyConfig falls back to the DGLS map name when unknown.
  const mapWorkshopId = await resolveMapWorkshopId(supabaseAdmin, matchId);
  const { config } = await buildMatchzyConfig(supabaseAdmin, matchId, {
    demoUploadUrl: process.env.INGEST_WORKER_URL,
    demoUploadSecret: process.env.INGEST_UPLOAD_SECRET,
    maplistOverride: mapWorkshopId ?? undefined,
  });

  return NextResponse.json(config);
}
