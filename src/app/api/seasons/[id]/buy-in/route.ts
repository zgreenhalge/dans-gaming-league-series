import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSeason, isSeasonScheduleGenerated } from '@/lib/queries';
import { parseBuyInInput } from '@/lib/season-buy-in';

/**
 * Sets an UPCOMING regular season's buy-in. Editable only until its schedule is generated — once a
 * matchup draft (or a confirmed schedule) exists the roster is settled and so is what each player
 * owes.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminAccess();
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) {
    return NextResponse.json({ error: 'Invalid season ID' }, { status: 400 });
  }

  const season = await getSeason(seasonId);
  if (!season || season.is_gauntlet) {
    return NextResponse.json({ error: 'Regular season not found' }, { status: 404 });
  }
  if (season.status !== 'UPCOMING') {
    return NextResponse.json({ error: 'Only an upcoming season’s buy-in can be edited' }, { status: 400 });
  }

  const input = parseBuyInInput(await req.json().catch(() => null));
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  const supabaseAdmin = getAdminClient();
  try {
    if (await isSeasonScheduleGenerated(seasonId)) {
      return NextResponse.json({ error: 'The buy-in can’t change once the schedule is generated' }, { status: 409 });
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const { error } = await supabaseAdmin.from('seasons').update({ buy_in_amount: input.amount }).eq('id', seasonId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
