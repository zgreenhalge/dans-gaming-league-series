import { NextRequest, NextResponse } from 'next/server';
import { requireSeasonRosterAccess, mapSeasonRosterWriteError } from '@/lib/season-roster-access';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) return NextResponse.json({ error: 'Invalid season id' }, { status: 400 });

  const access = await requireSeasonRosterAccess(req, seasonId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const { data: player, error: playerErr } = await access.supabaseAdmin
    .from('players')
    .select('id')
    .eq('id', access.targetPlayerId)
    .maybeSingle();
  if (playerErr) return NextResponse.json({ error: playerErr.message }, { status: 500 });
  if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

  const { error: insertErr } = await access.supabaseAdmin
    .from('season_players')
    .insert({ season_id: seasonId, player_id: access.targetPlayerId });
  if (insertErr && (insertErr as { code?: string }).code !== '23505') {
    const mapped = mapSeasonRosterWriteError(insertErr as { code?: string; message: string });
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) return NextResponse.json({ error: 'Invalid season id' }, { status: 400 });

  const access = await requireSeasonRosterAccess(req, seasonId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const { error: deleteErr } = await access.supabaseAdmin
    .from('season_players')
    .delete()
    .eq('season_id', seasonId)
    .eq('player_id', access.targetPlayerId);
  if (deleteErr) {
    const mapped = mapSeasonRosterWriteError(deleteErr as { code?: string; message: string });
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  return NextResponse.json({ ok: true });
}
