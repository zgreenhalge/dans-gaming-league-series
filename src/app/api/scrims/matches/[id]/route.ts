// Changes a scrim match before it starts — any of `PATCH { workshop }` (a Steam Workshop link or item
// id, any map, `resolveScrimMap()`), `{ side }` (a `ScrimSideChoice`)
// and `{ lineup: { shirts, skins } }`, the lineup drawn from the night's checked-in players — or
// discards it (`DELETE`). The players in the match or an admin (`requireScrimMatchAccess()`). Changes
// are refused (409) once it has a score or has been started (`isScrimMatchEditable()`); discarding
// once it has a score or holds the server (`isScrimMatchDiscardable()`). Starting it is the shared
// `POST /api/matches/[id]/server/provision`.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { accessDenied } from '@/lib/access-control';
import { parseRouteId } from '@/lib/util';
import { getMapsForWorkshopPicker } from '@/lib/queries';
import { workshopIdFromInput } from '@/lib/workshop';
import { requireScrimMatchAccess, checkedInPlayerIds } from '@/lib/scrim-match-access';
import {
  deleteScrimMatch,
  isScrimMatchDiscardable,
  isScrimMatchEditable,
  parseScrimTeams,
  setScrimMatchLineup,
  resolveScrimMap,
  setScrimMatchMap,
  setScrimMatchSideChoice,
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

  const body = (await req.json().catch(() => null)) as { workshop?: unknown; lineup?: unknown; side?: unknown } | null;
  const workshopId = body?.workshop !== undefined ? workshopIdFromInput(typeof body.workshop === 'string' ? body.workshop : null) : undefined;
  const lineup = body?.lineup !== undefined ? parseScrimTeams(body.lineup) : undefined;
  const side = body?.side;
  if (workshopId === undefined && lineup === undefined && side === undefined) {
    return NextResponse.json({ error: 'Send a workshop map, a side and/or a lineup' }, { status: 400 });
  }
  if (workshopId === null) {
    return NextResponse.json({ error: 'workshop must be a Steam Workshop link or item id' }, { status: 400 });
  }
  if (lineup === null) return NextResponse.json({ error: 'lineup must be two distinct players per side' }, { status: 400 });
  if (side !== undefined && !SCRIM_SIDE_CHOICES.includes(side as ScrimSideChoice)) {
    return NextResponse.json({ error: `side must be one of ${SCRIM_SIDE_CHOICES.join(', ')}` }, { status: 400 });
  }

  const [maps, checkedIn] = await Promise.all([
    workshopId !== undefined ? getMapsForWorkshopPicker() : Promise.resolve([]),
    lineup ? checkedInPlayerIds(access.match.night_id) : Promise.resolve([]),
  ]);
  // A player joining the lineup must be checked in; one already in it stays even after checking out.
  const current = [...access.match.shirts, ...access.match.skins];
  if (lineup && ![...lineup.shirts, ...lineup.skins].every((id) => checkedIn.includes(id) || current.includes(id))) {
    return NextResponse.json({ error: 'Every player joining the lineup must be checked in' }, { status: 400 });
  }

  const db = getAdminClient();
  try {
    if (workshopId !== undefined) await setScrimMatchMap(db, matchId, await resolveScrimMap(workshopId, maps));
    if (side !== undefined) await setScrimMatchSideChoice(db, matchId, side as ScrimSideChoice);
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
  if (!isScrimMatchDiscardable(access.match)) {
    return NextResponse.json({ error: 'This match is scored or running on the server, so it can no longer be discarded' }, { status: 409 });
  }

  try {
    await deleteScrimMatch(getAdminClient(), matchId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Discarding the match failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
