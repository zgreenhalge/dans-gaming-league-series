import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { parseSeasonId } from '@/lib/util';
import { parseBuyInInput } from '@/lib/season-buy-in';

type SetBuyInResult = { status: 'ok' | 'not-found' | 'not-upcoming' | 'schedule-generated' };

/** HTTP response for each refusal `set_season_buy_in()` can report. */
const REFUSALS: Record<Exclude<SetBuyInResult['status'], 'ok'>, { error: string; status: number }> = {
  'not-found': { error: 'Regular season not found', status: 404 },
  'not-upcoming': { error: 'Only an upcoming season’s buy-in can be edited', status: 400 },
  'schedule-generated': { error: 'The buy-in can’t change once the schedule is generated', status: 409 },
};

/**
 * Sets an UPCOMING regular season's buy-in: an amount (`0` for a free season) or `null` for TBD. Editable only until its schedule is generated — once a
 * matchup draft (or a confirmed schedule) exists the roster is settled and so is what each player
 * owes. The `set_season_buy_in()` DB function checks the season's status and schedule and writes
 * the amount under the season row's lock, so a schedule generated concurrently can't slip between
 * the check and the write.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminAccess();
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await params;
  const seasonId = parseSeasonId(id);
  if (seasonId === null) {
    return NextResponse.json({ error: 'Invalid season ID' }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as { buy_in_amount?: unknown } | null;
  if (body?.buy_in_amount === undefined) {
    return NextResponse.json({ error: 'buy_in_amount is required (null for TBD)' }, { status: 400 });
  }
  const input = parseBuyInInput(body);
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  const { data, error } = await getAdminClient().rpc('set_season_buy_in', {
    p_season_id: seasonId,
    p_amount: input.amount,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { status } = data as SetBuyInResult;
  if (status !== 'ok') {
    const refusal = REFUSALS[status];
    return NextResponse.json({ error: refusal.error }, { status: refusal.status });
  }
  return NextResponse.json({ ok: true });
}
