// Pre-matches rounds for a scrim night: queues `POST { games: [{ shirts, skins }, …] }` — the games of
// a plan the night page's Schedule Lab (`buildFormatPlan()`) previewed, in play order — as the
// night's next matches, each on a random map like an ad-hoc match (`queueScrimMatches()`, which the ad-hoc route calls with one lineup). Every
// player must be checked in. Same gate as making the next match (`requireScrimNightMatchAccess()`):
// any checked-in player or an admin, once check-in is open; 409 while the night has a match without
// a score.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { accessDenied } from '@/lib/access-control';
import { requireScrimNightMatchAccess } from '@/lib/scrim-match-access';
import { getMapsForWorkshopPicker } from '@/lib/queries';
import { parseScrimTeams, queueScrimMatches, ScrimMatchConflictError } from '@/lib/scrim-matches';
import type { ScrimTeams } from '@/lib/scrim-matchmaking';

/** The most matches one request may queue — above the largest plan the Schedule Lab builds (24 players,
 *  16 rounds of groups, with doubleheaders). */
const MAX_QUEUED = 256;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireScrimNightMatchAccess((await params).id);
  if (!access.ok) return accessDenied(access);
  const { night, checkedIn } = access;

  const body = (await req.json().catch(() => null)) as { games?: unknown } | null;
  const raw = Array.isArray(body?.games) ? body.games : null;
  const games = raw?.map(parseScrimTeams) ?? null;
  if (!games || games.length === 0 || games.length > MAX_QUEUED || games.some((g) => g === null)) {
    return NextResponse.json({ error: `games must be 1–${MAX_QUEUED} lineups of two distinct players per side` }, { status: 400 });
  }
  const teams = games as ScrimTeams[];
  if (!teams.every((t) => [...t.shirts, ...t.skins].every((id) => checkedIn.includes(id)))) {
    return NextResponse.json({ error: 'Every player in a pre-matched round must be checked in' }, { status: 400 });
  }

  const maps = await getMapsForWorkshopPicker();

  try {
    const matchIds = await queueScrimMatches(getAdminClient(), night.id, teams, maps);
    return NextResponse.json({ ok: true, matchIds }, { status: 201 });
  } catch (err) {
    if (err instanceof ScrimMatchConflictError) return NextResponse.json({ error: err.message }, { status: 409 });
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Queueing the matches failed' }, { status: 500 });
  }
}
