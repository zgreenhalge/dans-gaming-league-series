// Changes a scrim match before it starts — any of `PATCH { map }`, `{ side }` (a `ScrimSideChoice`)
// and `{ lineup: { shirts, skins } }`, the lineup drawn from the night's checked-in players — or
// discards it (`DELETE`). The players in
// the match or an admin (`requireScrimMatchAccess()`); 409 once it has a score or has been started
// (`isScrimMatchEditable()`). Starting it is the shared `POST /api/matches/[id]/server/provision`.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { accessDenied } from '@/lib/access-control';
import { parseRouteId } from '@/lib/util';
import { getMapsForWorkshopPicker } from '@/lib/queries';
import { requireScrimMatchAccess, checkedInPlayerIds } from '@/lib/scrim-match-access';
import {
  deleteScrimMatch,
  isScrimMatchEditable,
  parseScrimTeams,
  resolveScrimSide,
  setScrimMatchLineup,
  setScrimMatchMap,
  setScrimMatchSide,
  SCRIM_SIDE_CHOICES,
  type ScrimSideChoice,
} from '@/lib/scrim-matches';

const LOCKED = 'This match has started or been scored, so it can no longer be changed';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const matchId = parseRouteId((await params).id);
  if (matchId === null) return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  const access = await requireScrimMatchAccess(matchId);
  if (!access.ok) return accessDenied(access);
  if (!isScrimMatchEditable(access.match)) return NextResponse.json({ error: LOCKED }, { status: 409 });

  const body = (await req.json().catch(() => null)) as { map?: unknown; lineup?: unknown; side?: unknown } | null;
  const map = typeof body?.map === 'string' ? body.map : undefined;
  const lineup = body?.lineup !== undefined ? parseScrimTeams(body.lineup) : undefined;
  const side = body?.side;
  if (map === undefined && lineup === undefined && side === undefined) {
    return NextResponse.json({ error: 'Send a map, a side and/or a lineup' }, { status: 400 });
  }
  if (lineup === null) return NextResponse.json({ error: 'lineup must be two distinct players per side' }, { status: 400 });
  if (side !== undefined && !SCRIM_SIDE_CHOICES.includes(side as ScrimSideChoice)) {
    return NextResponse.json({ error: `side must be one of ${SCRIM_SIDE_CHOICES.join(', ')}` }, { status: 400 });
  }

  const [maps, checkedIn] = await Promise.all([
    map !== undefined ? getMapsForWorkshopPicker() : Promise.resolve([]),
    lineup ? checkedInPlayerIds(access.nightId) : Promise.resolve([]),
  ]);
  if (map !== undefined && !maps.some((m) => m.name === map)) {
    return NextResponse.json({ error: `Unknown map "${map}"` }, { status: 400 });
  }
  if (lineup && ![...lineup.shirts, ...lineup.skins].every((id) => checkedIn.includes(id))) {
    return NextResponse.json({ error: 'Every player in the lineup must be checked in' }, { status: 400 });
  }

  const db = getAdminClient();
  try {
    if (map !== undefined) await setScrimMatchMap(db, matchId, map);
    if (side !== undefined) await setScrimMatchSide(db, matchId, resolveScrimSide(side as ScrimSideChoice));
    if (lineup) await setScrimMatchLineup(db, matchId, lineup);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Updating the match failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const matchId = parseRouteId((await params).id);
  if (matchId === null) return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  const access = await requireScrimMatchAccess(matchId);
  if (!access.ok) return accessDenied(access);
  if (!isScrimMatchEditable(access.match)) return NextResponse.json({ error: LOCKED }, { status: 409 });

  try {
    await deleteScrimMatch(getAdminClient(), matchId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Discarding the match failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
