// Changes a scrim match before it starts — any of `PATCH { workshop }` (a Steam Workshop link or item
// id, any map, `resolveScrimMap()`), `{ side }` (a `ScrimSideChoice`)
// and `{ lineup: { shirts, skins } }`, the lineup drawn from the night's checked-in players, applied
// together by `updateScrimMatch()` — or discards it (`DELETE`, `discardScrimMatch()`). The players in
// the match or an admin (`requireScrimMatchAccess()`). Both send `{ revision }`, the match's
// `revision` as the client saw it, and are refused (409, `code: 'match_changed'`) when the match has
// moved on since. Changes are also refused (409) once it has a score or has been started
// (`isScrimMatchEditable()`); discarding once it has a score or holds the server
// (`isScrimMatchDiscardable()`) — both checked inside the write. Starting it is the shared
// `POST /api/matches/[id]/server/provision`.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { accessDenied } from '@/lib/access-control';
import { parseRouteId } from '@/lib/util';
import { getMapsForWorkshopPicker } from '@/lib/queries';
import { workshopIdFromInput } from '@/lib/workshop';
import { requireScrimMatchAccess, checkedInPlayerIds } from '@/lib/scrim-match-access';
import {
  discardScrimMatch,
  isScrimMatchDiscardable,
  isScrimMatchEditable,
  parseScrimRevision,
  parseScrimTeams,
  resolveScrimMap,
  updateScrimMatch,
  ScrimMatchChangedError,
  ScrimMatchConflictError,
  SCRIM_MATCH_LOCKED,
  SCRIM_MATCH_NOT_DISCARDABLE,
  SCRIM_MATCH_CHANGED_CODE,
  SCRIM_REVISION_INVALID,
  SCRIM_SIDE_CHOICES,
  type ScrimSideChoice,
} from '@/lib/scrim-matches';

/** The response for a write that threw: 409 for a refusal (`code: 'match_changed'` when the match
 *  moved on, so the client reloads), 500 otherwise. */
function writeFailed(err: unknown, fallback: string): NextResponse {
  if (err instanceof ScrimMatchConflictError) {
    return NextResponse.json({ error: err.message, ...(err instanceof ScrimMatchChangedError && { code: SCRIM_MATCH_CHANGED_CODE }) }, { status: 409 });
  }
  return NextResponse.json({ error: err instanceof Error ? err.message : fallback }, { status: 500 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const matchId = parseRouteId((await params).id);
  if (matchId === null) return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  const access = await requireScrimMatchAccess(matchId);
  if (!access.ok) return accessDenied(access);
  if (!isScrimMatchEditable(access.match)) return NextResponse.json({ error: SCRIM_MATCH_LOCKED }, { status: 409 });

  const body = (await req.json().catch(() => null)) as { workshop?: unknown; lineup?: unknown; side?: unknown; revision?: unknown } | null;
  const revision = parseScrimRevision(body?.revision);
  const workshopId = body?.workshop !== undefined ? workshopIdFromInput(typeof body.workshop === 'string' ? body.workshop : null) : undefined;
  const lineup = body?.lineup !== undefined ? parseScrimTeams(body.lineup) : undefined;
  const side = body?.side;
  if (revision === null) return NextResponse.json({ error: SCRIM_REVISION_INVALID }, { status: 400 });
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

  const map = workshopId !== undefined ? await resolveScrimMap(workshopId, maps) : undefined;
  if (map === null) return NextResponse.json({ error: 'Steam has no workshop item with that id' }, { status: 400 });

  try {
    const next = await updateScrimMatch(getAdminClient(), matchId, revision, { map, side: side as ScrimSideChoice | undefined, lineup });
    return NextResponse.json({ ok: true, revision: next });
  } catch (err) {
    return writeFailed(err, 'Updating the match failed');
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const matchId = parseRouteId((await params).id);
  if (matchId === null) return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  const access = await requireScrimMatchAccess(matchId);
  if (!access.ok) return accessDenied(access);
  if (!isScrimMatchDiscardable(access.match)) return NextResponse.json({ error: SCRIM_MATCH_NOT_DISCARDABLE }, { status: 409 });
  const revision = parseScrimRevision(((await req.json().catch(() => null)) as { revision?: unknown } | null)?.revision);
  if (revision === null) return NextResponse.json({ error: SCRIM_REVISION_INVALID }, { status: 400 });

  try {
    await discardScrimMatch(getAdminClient(), matchId, revision);
  } catch (err) {
    return writeFailed(err, 'Discarding the match failed');
  }
  return NextResponse.json({ ok: true });
}
