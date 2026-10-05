import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { getAdminClient } from '@/lib/supabase-admin';
import { isPlayerAdmin } from '@/lib/queries';
import { extractSeasonNumber } from '@/lib/util';
import { parseMapPoolInput, upsertNewMaps } from '@/lib/season-map-pool';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session?.user?.playerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!(await isPlayerAdmin(session.user.playerId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabaseAdmin = getAdminClient();

  const body = await req.json().catch(() => null);
  const input = parseMapPoolInput(body);
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  const { data: seasons, error: fetchErr } = await supabaseAdmin
    .from('seasons')
    .select('name')
    .eq('is_gauntlet', false);

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  let maxNum = 0;
  for (const s of seasons ?? []) {
    const n = extractSeasonNumber((s as { name: string }).name);
    if (n !== null && n > maxNum) maxNum = n;
  }

  const name = `Season ${maxNum + 1} Regular Season`;

  const mapErr = await upsertNewMaps(supabaseAdmin, input.newMaps);
  if (mapErr) {
    return NextResponse.json({ error: mapErr }, { status: 500 });
  }

  const { data: created, error: insertErr } = await supabaseAdmin
    .from('seasons')
    .insert({
      name,
      status: 'UPCOMING',
      is_gauntlet: false,
      map_pool: input.mapPool.length > 0 ? input.mapPool : null,
      target_win_rounds: 13,
    })
    .select('*')
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json(created, { status: 201 });
}
