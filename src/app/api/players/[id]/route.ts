import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { getAdminClient } from '@/lib/supabase-admin';
import { recordNameChange, NAME_HISTORY_LOG_OPERATION } from '@/lib/player-name-history';
import { recordOpsError } from '@/lib/ops-errors';

// Admin player management (#144): edit a player's display name, toggle their `is_admin` flag, or
// change their Steam link (unlink, or set a SteamID64 by hand). Admin-only. All three edits go
// through this one route with a whitelisted body — there are no side effects to isolate the way the
// match /score and /veto routes have, so a single partial-update route is simpler than three.

const supabaseAdmin = getAdminClient();

/** SteamID64: 17 decimal digits. */
const STEAM_ID_RE = /^\d{17}$/;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  const callerId = session?.user?.playerId;
  if (!callerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: callerRow } = await supabaseAdmin
    .from('players')
    .select('is_admin')
    .eq('id', callerId)
    .maybeSingle();
  if (!(callerRow as { is_admin?: boolean } | null)?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const targetId = Number(id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ error: 'Invalid player ID' }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as
    | { name?: unknown; is_admin?: unknown; steam_id?: unknown; seed_ehog?: unknown }
    | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  let renamedFrom: string | null = null;

  // Display name
  if ('name' in body) {
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return NextResponse.json({ error: 'Name must be a non-empty string' }, { status: 400 });
    }
    update.name = body.name.trim();

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('players')
      .select('name')
      .eq('id', targetId)
      .maybeSingle();
    if (existingError) {
      // Can't determine the "from" name, so the rename below will proceed unlogged — surface that
      // rather than let it pass silently.
      await recordOpsError(
        supabaseAdmin,
        'player',
        targetId,
        NAME_HISTORY_LOG_OPERATION,
        `Could not read prior name before rename: ${existingError.message}`,
      );
    }
    const existingName = (existing as { name?: string } | null)?.name;
    if (existingName && existingName !== update.name) renamedFrom = existingName;
  }

  // Admin flag — you can't demote yourself (prevents locking every admin out).
  if ('is_admin' in body) {
    if (typeof body.is_admin !== 'boolean') {
      return NextResponse.json({ error: 'is_admin must be a boolean' }, { status: 400 });
    }
    if (body.is_admin === false && targetId === callerId) {
      return NextResponse.json({ error: "You can't remove your own admin access." }, { status: 400 });
    }
    update.is_admin = body.is_admin;
  }

  // Steam link. `null` unlinks; a SteamID64 links by hand. Either way clear the cached
  // nickname/avatar/refresh timestamp so the refresh-steam cron repopulates them from the new id.
  if ('steam_id' in body) {
    if (body.steam_id === null) {
      Object.assign(update, {
        steam_id: null,
        steam_nickname: null,
        steam_avatar_url: null,
        steam_refreshed_at: null,
      });
    } else if (typeof body.steam_id === 'string' && STEAM_ID_RE.test(body.steam_id)) {
      // Steam ids must be unique — a duplicate would break login resolution.
      const { data: clash } = await supabaseAdmin
        .from('players')
        .select('id')
        .eq('steam_id', body.steam_id)
        .neq('id', targetId)
        .maybeSingle();
      if (clash) {
        return NextResponse.json({ error: 'That Steam ID is already linked to another player.' }, { status: 409 });
      }
      Object.assign(update, {
        steam_id: body.steam_id,
        steam_nickname: null,
        steam_avatar_url: null,
        steam_refreshed_at: null,
      });
    } else {
      return NextResponse.json({ error: 'steam_id must be null or a 17-digit SteamID64' }, { status: 400 });
    }
  }

  // Seed EHOG — the starting rating a known new player is seeded at, in place of the global
  // default, until their first rated match. `null` clears it back to the default. The (10, 100)
  // bound is exclusive: those are the display transform's unreachable asymptotes.
  if ('seed_ehog' in body) {
    if (body.seed_ehog === null) {
      update.seed_ehog = null;
    } else if (typeof body.seed_ehog === 'number' && body.seed_ehog > 10 && body.seed_ehog < 100) {
      update.seed_ehog = body.seed_ehog;
    } else {
      return NextResponse.json({ error: 'seed_ehog must be null or a number strictly between 10 and 100' }, { status: 400 });
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('players')
    .update(update)
    .eq('id', targetId)
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

  if (renamedFrom) {
    await recordNameChange(supabaseAdmin, targetId, renamedFrom, (data as { name: string }).name);
  }

  return NextResponse.json({ ok: true, player: data });
}
