import { NextRequest, NextResponse } from 'next/server';
import { requireSeasonRosterAccess, mapSeasonRosterWriteError } from '@/lib/season-roster-access';
import { grantParticipantRole, revokeParticipantRole } from '@/lib/discord-roles';
import { afterBestEffort } from '@/lib/after';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) return NextResponse.json({ error: 'Invalid season id' }, { status: 400 });

  const access = await requireSeasonRosterAccess(req, seasonId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const { data: player, error: playerErr } = await access.supabaseAdmin
    .from('players')
    .select('id, discord_id')
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

  const discordId = (player as { discord_id: string | null }).discord_id;
  afterBestEffort(`discord-roles: grant @Participants to player ${access.targetPlayerId}`, () =>
    grantParticipantRole(access.supabaseAdmin, access.targetPlayerId, discordId),
  );

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) return NextResponse.json({ error: 'Invalid season id' }, { status: 400 });

  const access = await requireSeasonRosterAccess(req, seasonId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  // Independent reads/writes — the discord_id lookup doesn't gate the delete (unlike POST's
  // player-exists check, which must happen first) — run them concurrently.
  const [{ data: player }, { error: deleteErr }] = await Promise.all([
    access.supabaseAdmin.from('players').select('discord_id').eq('id', access.targetPlayerId).maybeSingle(),
    access.supabaseAdmin.from('season_players').delete().eq('season_id', seasonId).eq('player_id', access.targetPlayerId),
  ]);
  if (deleteErr) {
    const mapped = mapSeasonRosterWriteError(deleteErr as { code?: string; message: string });
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  const discordId = (player as { discord_id: string | null } | null)?.discord_id ?? null;
  afterBestEffort(`discord-roles: revoke @Participants from player ${access.targetPlayerId}`, () =>
    revokeParticipantRole(access.supabaseAdmin, access.targetPlayerId, discordId),
  );

  return NextResponse.json({ ok: true });
}
