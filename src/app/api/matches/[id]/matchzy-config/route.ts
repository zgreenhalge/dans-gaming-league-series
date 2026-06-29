// Machine-authenticated MatchZy config endpoint — the `matchzy_loadmatch_url` target. The DatHost
// server fetches this (with `X-MatchZy-Token`) to load the per-match config. NOT session-gated: it's
// called by the game server, not a browser.
//
// Auth: shared secret in `X-MatchZy-Token`, constant-time compared against `MATCHZY_CONFIG_SECRET`.

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { buildMatchzyConfig } from '@/lib/matchzy';
import { resolveMapWorkshopId } from '@/lib/dathost-lifecycle';

function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const expected = process.env.MATCHZY_CONFIG_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'MatchZy config not configured' }, { status: 503 });
  }
  if (!secretsMatch(req.headers.get('x-matchzy-token'), expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const matchId = Number(id);
  if (!Number.isInteger(matchId) || matchId <= 0) {
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
