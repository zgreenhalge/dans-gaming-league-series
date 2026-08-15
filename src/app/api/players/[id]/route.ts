import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { recordNameChange, recordNameHistoryLogError, renameFields } from '@/lib/player-name-history';
import { isDiscordIdTaken } from '@/lib/discord-link';
import { syncParticipantRoleForPlayer, createNameRole, renameNameRole, deleteNameRole } from '@/lib/discord-roles';
import { afterBestEffort } from '@/lib/after';
import type { Database } from '@/lib/database.types';

type PlayerUpdate = Database['public']['Tables']['players']['Update'];

// Admin player management (#144): edit a player's display name, toggle their `is_admin` flag, or
// change their Steam link (unlink, or set a SteamID64 by hand). Admin-only. All three edits go
// through this one route with a whitelisted body — there are no side effects to isolate the way the
// match /score and /veto routes have, so a single partial-update route is simpler than three.

/** SteamID64: 17 decimal digits. */
const STEAM_ID_RE = /^\d{17}$/;

/** Discord snowflake id: 17-20 decimal digits. */
const DISCORD_ID_RE = /^\d{17,20}$/;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Resolved per-request, not at module scope, so a test can inject a fresh fake client
  // (getAdminClient() resolves once at import time otherwise, before any override could take effect).
  const supabaseAdmin = getAdminClient();

  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const callerId = access.playerId;

  const { id } = await params;
  const targetId = Number(id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ error: 'Invalid player ID' }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as
    | { name?: unknown; is_admin?: unknown; steam_id?: unknown; discord_id?: unknown; seed_ehog?: unknown }
    | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const update: PlayerUpdate = {};
  let renamedFrom: string | null = null;
  let unlinkingNameRoleId: string | null = null;

  // Display name
  if ('name' in body) {
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return NextResponse.json({ error: 'Name must be a non-empty string' }, { status: 400 });
    }
    const trimmed = body.name.trim();

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('players')
      .select('name')
      .eq('id', targetId)
      .maybeSingle();
    if (existingError) {
      // Can't determine the "from" name, so the rename below will proceed unlogged — surface that
      // rather than let it pass silently.
      await recordNameHistoryLogError(
        supabaseAdmin,
        targetId,
        `Could not read prior name before rename: ${existingError.message}`,
      );
    }
    const existingName = (existing as { name?: string } | null)?.name;
    if (existingName && existingName !== trimmed) {
      renamedFrom = existingName;
      // renameFields() also resets the self-service cooldown's clock — an admin rename counts as
      // "this player's name changed" the same as a self-service one, for the once-a-week gate on
      // their next one.
      Object.assign(update, renameFields(trimmed));
    } else {
      update.name = trimmed;
    }
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

  // Discord link (#394). `null` unlinks; a snowflake id links by hand — the same admin-override
  // path steam_id above has, for a player who can't complete the self-service OAuth flow
  // themselves. No cached nickname/avatar to clear here (unlike Steam), since none is stored.
  // Unlinking never touches @Participants -- see players/me/discord/route.ts's comment -- but it
  // does delete the player's name-color role, since that role only makes sense while linked.
  if ('discord_id' in body) {
    if (body.discord_id === null) {
      const { data: currentLink } = await supabaseAdmin
        .from('players')
        .select('discord_name_role_id')
        .eq('id', targetId)
        .maybeSingle();
      unlinkingNameRoleId = (currentLink as { discord_name_role_id: string | null } | null)?.discord_name_role_id ?? null;
      update.discord_id = null;
      update.discord_name_role_id = null;
    } else if (typeof body.discord_id === 'string' && DISCORD_ID_RE.test(body.discord_id)) {
      let taken: boolean;
      try {
        taken = await isDiscordIdTaken(supabaseAdmin, body.discord_id, targetId);
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not verify Discord ID' }, { status: 500 });
      }
      if (taken) {
        return NextResponse.json({ error: 'That Discord account is already linked to another player.' }, { status: 409 });
      }
      update.discord_id = body.discord_id;
    } else {
      return NextResponse.json({ error: 'discord_id must be null or a 17-20 digit Discord user id' }, { status: 400 });
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
  if (error) {
    // The DB's own unique constraints (name, players_steam_id_key, players_discord_id_key) are the
    // backstop for this route's own pre-checks above racing a concurrent write — report it the same
    // way a check that caught it up front would, not as a generic 500 with a raw Postgres message.
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json(
        { error: 'That name, Steam ID, or Discord ID is already in use by another player.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

  if (renamedFrom) {
    await recordNameChange(supabaseAdmin, targetId, renamedFrom, (data as { name: string }).name);
    const currentNameRoleId = (data as { discord_name_role_id: string | null }).discord_name_role_id;
    if (currentNameRoleId) {
      afterBestEffort(`discord-roles: rename name role for admin-renamed player ${targetId}`, () =>
        renameNameRole(supabaseAdmin, targetId, currentNameRoleId, (data as { name: string }).name),
      );
    }
  }

  // @Participants sync + name-role creation for a newly-linked discord_id -- grants/creates right
  // away if this player is already on the active roster / linked for the first time, same reasoning
  // as the OAuth callback's own calls. Unlinking is deliberately not handled here for @Participants;
  // see players/me/discord/route.ts's comment. The name role, however, is deleted on unlink above.
  if ('discord_id' in body && body.discord_id !== null) {
    const linkedDiscordId = (data as { discord_id: string | null }).discord_id;
    afterBestEffort(`discord-roles: sync @Participants for admin-linked player ${targetId}`, () =>
      syncParticipantRoleForPlayer(supabaseAdmin, targetId, linkedDiscordId),
    );
    afterBestEffort(`discord-roles: create name role for admin-linked player ${targetId}`, () =>
      createNameRole(supabaseAdmin, targetId, linkedDiscordId, (data as { name: string }).name),
    );
  }
  if ('discord_id' in body && body.discord_id === null && unlinkingNameRoleId) {
    afterBestEffort(`discord-roles: delete name role for admin-unlinked player ${targetId}`, () =>
      deleteNameRole(supabaseAdmin, targetId, unlinkingNameRoleId),
    );
  }

  return NextResponse.json({ ok: true, player: data });
}
