import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSeason, getLinkedGauntlet } from '@/lib/queries';
import { createManualGauntletMatch } from '@/lib/gauntlet-engine';

const supabaseAdmin = getAdminClient();

function parsePlayerPair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [a, b] = value;
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isInteger(a) || !Number.isInteger(b)) return null;
  return [a, b];
}

/**
 * Hand-creates a single match under a gauntlet season's given round, bypassing `gauntlet_pods`
 * entirely — no pairing invariant enforced, no propagation, no auto-materialization. For building
 * rounds the automated bracket generator doesn't cover. The gauntlet must already exist (via the
 * normal build route or the manual shell route); this only adds matches to it.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminAccess();
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await params;
  const regularSeasonId = Number(id);
  if (!Number.isFinite(regularSeasonId)) {
    return NextResponse.json({ error: 'Invalid season ID' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const round_number = (body as { round_number?: unknown })?.round_number;
  const shirts = parsePlayerPair((body as { shirts?: unknown })?.shirts);
  const skins = parsePlayerPair((body as { skins?: unknown })?.skins);
  if (typeof round_number !== 'number' || !Number.isInteger(round_number) || round_number < 1) {
    return NextResponse.json({ error: 'round_number must be a positive integer' }, { status: 400 });
  }
  if (!shirts || !skins) {
    return NextResponse.json({ error: 'shirts and skins must each be a pair of player ids' }, { status: 400 });
  }

  const regularSeason = await getSeason(regularSeasonId);
  if (!regularSeason || regularSeason.is_gauntlet) {
    return NextResponse.json({ error: 'Regular season not found' }, { status: 404 });
  }

  const gauntletSeason = await getLinkedGauntlet(regularSeason.name);
  if (!gauntletSeason) {
    return NextResponse.json({ error: 'This season has no gauntlet yet — create one first' }, { status: 404 });
  }

  let result;
  try {
    result = await createManualGauntletMatch(supabaseAdmin, gauntletSeason.id, round_number, shirts, skins);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  switch (result.status) {
    case 'not-gauntlet':
      return NextResponse.json({ error: 'This season has no gauntlet yet — create one first' }, { status: 404 });
    case 'invalid':
      return NextResponse.json({ error: result.reason }, { status: 400 });
    case 'created':
      return NextResponse.json({ matchId: result.matchId }, { status: 201 });
  }
}
