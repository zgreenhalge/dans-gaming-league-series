import { NextRequest, NextResponse } from 'next/server';
import { requireMatchAccess } from '@/lib/match-access';
import { accessDenied } from '@/lib/access-control';
import { matchWriteError } from '@/lib/route-errors';
import { isPlayedScore, parseRouteId } from '@/lib/util';
import { getAdminClient } from '@/lib/supabase-admin';
import { GAUNTLET_BAN_FIELDS, gauntletAutoPick, isVetoComplete, isVetoWindowOpen, type VetoFields } from '@/lib/veto';
import {
  provisionMatchServer,
  matchzyConfigContext,
  provisionErrorHandler,
  fetchServerStateRow,
  type MatchServerStateRow,
} from '@/lib/dathost-lifecycle';
import { afterBestEffort } from '@/lib/after';
import { clearOpsError } from '@/lib/ops-errors';
import { getLinkedRegularSeason } from '@/lib/queries/seasons';
import { VetoStepChangedError, getVetoFields, setVetoFields } from '@/lib/match-day';

const VALID_FIELDS = [
  'shirts_ban',
  'shirts_ban2',
  'skins_ban1',
  'skins_ban2',
  'shirts_pick',
  'skins_starting_side',
] as const;
type VetoField = (typeof VALID_FIELDS)[number];

const REGULAR_STEPS: VetoField[] = [
  'shirts_ban',
  'skins_ban1',
  'skins_ban2',
  'shirts_pick',
  'skins_starting_side',
];

type MatchRow = {
  id: number;
  final_score: string | null;
  scheduled_at: string | null;
  shirts_ban: string | null;
  shirts_ban2: string | null;
  skins_ban1: string | null;
  skins_ban2: string | null;
  shirts_pick: string | null;
  skins_starting_side: string | null;
  weeks: {
    seasons: {
      name: string;
      is_gauntlet: boolean;
      map_pool: string[] | null;
    };
  };
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabaseAdmin = getAdminClient();
  const { id } = await params;
  const matchId = parseRouteId(id);
  if (matchId === null) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }

  const access = await requireMatchAccess(matchId);
  if (!access.ok) return accessDenied(access);
  const { playerId, isAdmin } = access;

  const [{ data: matchRow }, { data: matchStats }] = await Promise.all([
    supabaseAdmin
      .from('matches')
      .select(
        'id, final_score, scheduled_at, shirts_ban, shirts_ban2, skins_ban1, skins_ban2, shirts_pick, skins_starting_side, weeks(seasons(name, is_gauntlet, map_pool))',
      )
      .eq('id', matchId)
      .maybeSingle(),
    supabaseAdmin
      .from('player_match_stats')
      .select('player_id, faction')
      .eq('match_id', matchId),
  ]);

  if (!matchRow) {
    return NextResponse.json({ error: 'Match not found' }, { status: 404 });
  }

  const allStats = (matchStats ?? []) as { player_id: number; faction: string }[];
  const myFaction = allStats.find((s) => s.player_id === playerId)?.faction ?? null;

  const m = matchRow as unknown as MatchRow;
  const season = m.weeks?.seasons;

  if (isPlayedScore(m.final_score)) {
    return NextResponse.json({ error: 'Match already played' }, { status: 403 });
  }

  // Non-admins need a scheduled time and an open veto window (`isVetoWindowOpen()`)
  if (!isAdmin) {
    if (!m.scheduled_at) {
      return NextResponse.json({ error: 'Match not yet scheduled' }, { status: 403 });
    }
    if (!isVetoWindowOpen(m.scheduled_at, Date.now())) {
      return NextResponse.json({ error: 'Veto window not open yet' }, { status: 403 });
    }
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.field !== 'string' || (typeof body.value !== 'string' && body.value !== null)) {
    return NextResponse.json({ error: 'Missing field or value' }, { status: 400 });
  }

  const field = body.field as VetoField;
  const value: string | null = body.value;

  if (!(VALID_FIELDS as readonly string[]).includes(field)) {
    return NextResponse.json({ error: 'Invalid field' }, { status: 400 });
  }

  // Clearing a field is admin-only
  if (value === null) {
    if (!isAdmin) {
      return NextResponse.json({ error: 'Only admins can clear a pick/ban' }, { status: 403 });
    }
    try {
      await setVetoFields(supabaseAdmin, matchId, { [field]: null });
    } catch (err) {
      return matchWriteError(err, 'Clearing the pick/ban failed');
    }
    return NextResponse.json({ ok: true });
  }

  const isGauntlet = season?.is_gauntlet ?? false;
  // A gauntlet season's own map_pool can be null for a pre-existing row created before its bans
  // started being carried over at creation — the pool it bans from is always the paired regular
  // season's (docs/glossary.md's Gauntlet entry).
  const mapPool: string[] = (isGauntlet && season
    ? (await getLinkedRegularSeason(season.name, supabaseAdmin))?.map_pool
    : season?.map_pool) ?? [];

  const currentValues: Record<VetoField, string | null> = {
    shirts_ban: m.shirts_ban,
    shirts_ban2: m.shirts_ban2,
    skins_ban1: m.skins_ban1,
    skins_ban2: m.skins_ban2,
    shirts_pick: m.shirts_pick,
    skins_starting_side: m.skins_starting_side,
  };

  if (isGauntlet) {
    // Gauntlet bans are simultaneous and shared per faction — either player may fill or correct
    // either of their faction's two ban slots, in any order, right up until the 4th ban locks in the
    // auto-picked map.
    if (field === 'shirts_pick' || field === 'skins_starting_side') {
      return NextResponse.json({ error: 'Not a valid gauntlet field' }, { status: 400 });
    }
    if (!isAdmin) {
      const stepFaction = field.startsWith('shirts_') ? 'SHIRTS' : 'SKINS';
      if (myFaction !== stepFaction) {
        return NextResponse.json({ error: "Not your faction's ban" }, { status: 403 });
      }
    }
    // Allow overwriting an already-set slot (any teammate, or admin, can correct it)
  } else {
    // Regular season: enforce sequential order for new entries; allow overwriting existing ones
    if (!REGULAR_STEPS.includes(field)) {
      return NextResponse.json({ error: 'Invalid field for this match type' }, { status: 400 });
    }
    if (currentValues[field] === null) {
      // Filling a new step: must be the next unfilled one in sequence
      const nextStep = REGULAR_STEPS.find((s) => currentValues[s] === null);
      if (!nextStep) {
        return NextResponse.json({ error: 'Pick/ban phase already complete' }, { status: 400 });
      }
      if (field !== nextStep) {
        return NextResponse.json({ error: `Expected next field: ${nextStep}` }, { status: 400 });
      }
    }
    // Overwriting an existing value: no sequence restriction, but faction still applies
    if (!isAdmin) {
      const stepFaction = field.startsWith('shirts_') ? 'SHIRTS' : 'SKINS';
      if (myFaction !== stepFaction) {
        return NextResponse.json({ error: "Not your faction's turn" }, { status: 403 });
      }
    }
  }

  // Validate value
  if (field === 'skins_starting_side') {
    if (value !== 'CT' && value !== 'T') {
      return NextResponse.json({ error: 'Side must be CT or T' }, { status: 400 });
    }
  } else {
    if (!mapPool.includes(value)) {
      return NextResponse.json({ error: 'Map not in pool' }, { status: 400 });
    }
    // Check value not already used by another field (exclude the field being overwritten)
    const usedMaps = [
      field !== 'shirts_ban'  ? m.shirts_ban  : null,
      field !== 'shirts_ban2' ? m.shirts_ban2 : null,
      field !== 'skins_ban1'  ? m.skins_ban1  : null,
      field !== 'skins_ban2'  ? m.skins_ban2  : null,
      field !== 'shirts_pick' ? m.shirts_pick : null,
    ].filter((v): v is string => v !== null);
    if (usedMaps.includes(value)) {
      return NextResponse.json({ error: 'Map already used' }, { status: 400 });
    }
  }

  // The write only lands while the field still holds the value this request read (`null` for a first
  // fill), so a step another request filled or changed since the read is refused, not overwritten. It
  // returns the row as the write left it, which everything after it reads: a concurrent request's
  // write is in it, where the row read at the start of the request is not.
  let row: VetoFields;
  try {
    row = await setVetoFields(supabaseAdmin, matchId, { [field]: value }, { [field]: currentValues[field] });

    // Gauntlet: once all 4 bans are set, auto-pick the remaining map. The pick follows from the bans
    // alone, so it is written against the bans it was derived from; if one changed meanwhile, that
    // change's own request derives the pick, and this one reads the row as it now stands.
    const pick = isGauntlet ? gauntletAutoPick(row, mapPool) : null;
    if (pick !== null && pick !== row.shirts_pick) {
      const bans = Object.fromEntries(GAUNTLET_BAN_FIELDS.map((f) => [f, row[f]]));
      try {
        row = await setVetoFields(supabaseAdmin, matchId, { shirts_pick: pick }, bans);
      } catch (err) {
        if (!(err instanceof VetoStepChangedError)) throw err;
        row = await getVetoFields(supabaseAdmin, matchId);
      }
    }
  } catch (err) {
    if (err instanceof VetoStepChangedError) return NextResponse.json({ error: err.message }, { status: 409 });
    return matchWriteError(err, 'Saving the pick/ban failed');
  }

  // Auto-provision the match server whenever the pick/ban is complete — not just on the first
  // completing edit — so a post-completion map correction re-provisions with the new map. But never
  // disrupt a server that's already booting/live: an admin stops it first to change the map. (The
  // `server_state` gate also keeps a redundant edit from re-provisioning an already-running server.)
  if (isVetoComplete(row, isGauntlet)) {
    let srv: MatchServerStateRow | null;
    try {
      srv = await fetchServerStateRow(supabaseAdmin, matchId);
    } catch (err) {
      // The pick/ban is saved; only the decision to auto-provision is unknown, so it must not proceed.
      return NextResponse.json(
        { error: `Saved, but checking the match server failed: ${err instanceof Error ? err.message : 'unknown error'}` },
        { status: 500 },
      );
    }
    const serverBusy = srv?.server_state === 'provisioning' || srv?.server_state === 'live';
    const base = process.env.APP_BASE_URL ?? req.nextUrl.origin;
    const ctx = matchzyConfigContext(base, matchId);
    if (!serverBusy && ctx) {
      afterBestEffort(
        `provisionMatchServer(${matchId})`,
        async () => {
          await provisionMatchServer(supabaseAdmin, matchId, ctx.configUrl, ctx.configAuth);
          await clearOpsError(supabaseAdmin, 'match', matchId, 'server_provision');
        },
        provisionErrorHandler(supabaseAdmin, 'auto-provision', matchId),
      );
    }
  }

  return NextResponse.json({ ok: true });
}
