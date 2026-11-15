import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { accessDenied } from '@/lib/access-control';
import { internalError } from '@/lib/route-errors';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSeasons } from '@/lib/queries';
import { nextRegularSeasonName } from '@/lib/util';
import type { Season } from '@/lib/types';
import { parseMapPoolInput } from '@/lib/season-map-pool';
import { createSeason } from '@/lib/season-setup';
import { parseBuyInInput } from '@/lib/season-buy-in';

export async function POST(req: NextRequest) {
  const access = await requireAdminAccess();
  if (!access.ok) return accessDenied(access);

  const supabaseAdmin = getAdminClient();

  const body = await req.json().catch(() => null);
  const input = parseMapPoolInput(body);
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  const buyIn = parseBuyInInput(body);
  if (!buyIn.ok) {
    return NextResponse.json({ error: buyIn.error }, { status: 400 });
  }

  let seasons: Season[];
  try {
    seasons = await getSeasons(supabaseAdmin);
  } catch (err) {
    return NextResponse.json({ error: (err as { message: string }).message }, { status: 500 });
  }

  const name = nextRegularSeasonName(seasons);

  try {
    const created = await createSeason(supabaseAdmin, { name, mapPool: input.mapPool, buyInAmount: buyIn.amount, newMaps: input.newMaps });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return internalError(err, 'Creating the season failed');
  }
}
