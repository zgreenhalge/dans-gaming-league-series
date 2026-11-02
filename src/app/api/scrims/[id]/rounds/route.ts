// Pre-matches rounds for a scrim night: queues `POST { games: [{ shirts, skins }, …] }` — the games of
// a plan the night page's Schedule Lab (`buildFormatPlan()`) previewed, in play order — as the
// night's next matches, each on a random map like an ad-hoc match (`queueScrimMatches()`). Every
// player must be checked in. Same gate as making the next match (`requireScrimNightMatchAccess()`):
// any checked-in player or an admin, once check-in is open; 409 while the night has a match without
// a score.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { accessDenied } from '@/lib/access-control';
import { requireScrimNightMatchAccess } from '@/lib/scrim-match-access';
import { getMapsForWorkshopPicker } from '@/lib/queries';
import { parseScrimTeams, queueScrimMatches, randomScrimMap, UnplayedScrimMatchError } from '@/lib/scrim-matches';
import type { ScrimTeams } from '@/lib/scrim-matchmaking';

/** The most matches one request may queue. */
const MAX_QUEUED = 64;

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
  if (maps.length === 0) return NextResponse.json({ error: 'No maps with a workshop id to play on' }, { status: 409 });

  try {
    const matchIds = await queueScrimMatches(getAdminClient(), night.id, teams.map((t) => ({ map: randomScrimMap(maps), teams: t })));
    return NextResponse.json({ ok: true, matchIds }, { status: 201 });
  } catch (err) {
    if (err instanceof UnplayedScrimMatchError) return NextResponse.json({ error: err.message }, { status: 409 });
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Queueing the matches failed' }, { status: 500 });
  }
}
