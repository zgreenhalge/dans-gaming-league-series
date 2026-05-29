import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createClient } from '@supabase/supabase-js';
import { authOptions } from '@/lib/authOptions';
import { isPlayedScore } from '@/lib/util';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

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
// Team blocks: Shirts bans first, then Skins
const PLAYOFF_STEPS: VetoField[] = ['shirts_ban', 'shirts_ban2', 'skins_ban1', 'skins_ban2'];

type MatchRow = {
  id: number;
  final_score: string | null;
  shirts_ban: string | null;
  shirts_ban2: string | null;
  skins_ban1: string | null;
  skins_ban2: string | null;
  shirts_pick: string | null;
  skins_starting_side: string | null;
  is_playoff_game: boolean;
  weeks: {
    seasons: {
      is_gauntlet: boolean;
      map_pool: string[] | null;
    };
  };
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const matchId = Number(id);
  if (!Number.isFinite(matchId)) {
    return NextResponse.json({ error: 'Invalid match ID' }, { status: 400 });
  }

  const playerId = session.user.playerId;

  const [{ data: matchRow }, { data: playerRow }, { data: matchStats }] = await Promise.all([
    supabaseAdmin
      .from('matches')
      .select(
        'id, final_score, shirts_ban, shirts_ban2, skins_ban1, skins_ban2, shirts_pick, skins_starting_side, is_playoff_game, weeks(seasons(is_gauntlet, map_pool))',
      )
      .eq('id', matchId)
      .maybeSingle(),
    supabaseAdmin.from('players').select('is_admin').eq('id', playerId).maybeSingle(),
    supabaseAdmin
      .from('player_match_stats')
      .select('player_id, faction')
      .eq('match_id', matchId),
  ]);

  if (!matchRow) {
    return NextResponse.json({ error: 'Match not found' }, { status: 404 });
  }

  const allStats = (matchStats ?? []) as { player_id: number; faction: string }[];
  const myStatRow = allStats.find((s) => s.player_id === playerId);
  const isInMatch = !!myStatRow;
  const myFaction = myStatRow?.faction ?? null;

  const isAdmin = !!(playerRow as { is_admin?: boolean } | null)?.is_admin;
  if (!isAdmin && !isInMatch) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const m = matchRow as unknown as MatchRow;
  const season = m.weeks?.seasons;

  if (isPlayedScore(m.final_score)) {
    return NextResponse.json({ error: 'Match already played' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.field !== 'string' || typeof body.value !== 'string') {
    return NextResponse.json({ error: 'Missing field or value' }, { status: 400 });
  }

  const field = body.field as VetoField;
  const value: string = body.value;

  if (!(VALID_FIELDS as readonly string[]).includes(field)) {
    return NextResponse.json({ error: 'Invalid field' }, { status: 400 });
  }

  const isGauntlet = season?.is_gauntlet ?? false;
  const isPlayoff = m.is_playoff_game && !isGauntlet;
  const mapPool: string[] = season?.map_pool ?? [];

  const currentValues: Record<VetoField, string | null> = {
    shirts_ban: m.shirts_ban,
    shirts_ban2: m.shirts_ban2,
    skins_ban1: m.skins_ban1,
    skins_ban2: m.skins_ban2,
    shirts_pick: m.shirts_pick,
    skins_starting_side: m.skins_starting_side,
  };

  if (isGauntlet) {
    // Gauntlet bans are simultaneous — each player submits their own fixed slot
    if (field === 'shirts_pick' || field === 'skins_starting_side') {
      return NextResponse.json({ error: 'Not a valid gauntlet field' }, { status: 400 });
    }
    if (!isAdmin) {
      const stepFaction = field.startsWith('shirts_') ? 'SHIRTS' : 'SKINS';
      if (myFaction !== stepFaction) {
        return NextResponse.json({ error: "Not your faction's ban" }, { status: 403 });
      }
      const factionPlayerIds = allStats
        .filter((s) => s.faction === stepFaction)
        .map((s) => s.player_id)
        .sort((a, b) => a - b);
      const myIndex = factionPlayerIds.indexOf(playerId);
      const myField: VetoField =
        stepFaction === 'SHIRTS'
          ? (myIndex === 0 ? 'shirts_ban' : 'shirts_ban2')
          : (myIndex === 0 ? 'skins_ban1' : 'skins_ban2');
      if (field !== myField) {
        return NextResponse.json({ error: 'Not your ban slot' }, { status: 403 });
      }
    }
    if (currentValues[field] !== null) {
      return NextResponse.json({ error: 'This ban slot is already set' }, { status: 400 });
    }
  } else {
    // Non-gauntlet: enforce sequential order
    const steps = isPlayoff ? PLAYOFF_STEPS : REGULAR_STEPS;
    const nextStep = steps.find((s) => currentValues[s] === null);
    if (!nextStep) {
      return NextResponse.json({ error: 'Veto sequence already complete' }, { status: 400 });
    }
    if (field !== nextStep) {
      return NextResponse.json({ error: `Expected next field: ${nextStep}` }, { status: 400 });
    }
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
    // Check value not already used
    const usedMaps = [m.shirts_ban, m.shirts_ban2, m.skins_ban1, m.skins_ban2, m.shirts_pick].filter(Boolean);
    if (usedMaps.includes(value)) {
      return NextResponse.json({ error: 'Map already used' }, { status: 400 });
    }
  }

  const update: Record<string, string | null> = { [field]: value };

  // For playoff/gauntlet: once all 4 bans are set, auto-pick the remaining map
  if (isGauntlet || isPlayoff) {
    const bansAfter = [
      field === 'shirts_ban'  ? value : m.shirts_ban,
      field === 'shirts_ban2' ? value : m.shirts_ban2,
      field === 'skins_ban1'  ? value : m.skins_ban1,
      field === 'skins_ban2'  ? value : m.skins_ban2,
    ].filter(Boolean) as string[];
    if (bansAfter.length === 4) {
      const remaining = mapPool.filter((map) => !bansAfter.includes(map));
      if (remaining.length === 1) update.shirts_pick = remaining[0];
    }
  }

  const { error } = await supabaseAdmin.from('matches').update(update).eq('id', matchId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
