import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { getAdminClient } from '@/lib/supabase-admin';
import { getPlayerNameHistory } from '@/lib/queries';
import { recordNameChange } from '@/lib/player-name-history';
import { normalizePlayerName, isValidPlayerName, PLAYER_NAME_MIN_LENGTH, PLAYER_NAME_MAX_LENGTH } from '@/lib/util';

// Self-service rename (issue #268): a player changes their own display name, in place on their
// profile page. Distinct from the admin-only `PATCH /api/players/[id]` — that route can rename any
// player at any time; this one is scoped to the caller's own row, restricted to letters/spaces, and
// rate-limited via `player_name_history`, the same table both routes log a successful rename to.

const supabaseAdmin = getAdminClient();

const RENAME_COOLDOWN_DAYS = 7;

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const playerId = session?.user?.playerId;
  if (!playerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  if (!body || typeof body.name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const next = normalizePlayerName(body.name);
  if (!isValidPlayerName(next)) {
    return NextResponse.json(
      {
        error: `Name must be ${PLAYER_NAME_MIN_LENGTH}-${PLAYER_NAME_MAX_LENGTH} letters — spaces allowed between words, no numbers or symbols.`,
      },
      { status: 400 },
    );
  }

  // Independent reads — the current name (to detect a no-op and log the "from") and this player's
  // rename history (for the cooldown check below) — batched since neither depends on the other.
  const [{ data: current, error: fetchError }, history] = await Promise.all([
    supabaseAdmin.from('players').select('name').eq('id', playerId).maybeSingle(),
    getPlayerNameHistory(playerId),
  ]);
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

  const previousName = (current as { name: string }).name;
  if (next === previousName) {
    return NextResponse.json({ ok: true, player: { id: playerId, name: previousName } });
  }

  // Once every RENAME_COOLDOWN_DAYS, based on this player's most recent recorded change — a player
  // who has never renamed has no history row, so no cooldown applies.
  const last = history[0];
  if (last) {
    const nextEligibleAt = new Date(last.changed_at);
    nextEligibleAt.setDate(nextEligibleAt.getDate() + RENAME_COOLDOWN_DAYS);
    if (nextEligibleAt.getTime() > Date.now()) {
      return NextResponse.json(
        { error: 'You can only change your name once a week.', nextEligibleAt: nextEligibleAt.toISOString() },
        { status: 429 },
      );
    }
  }

  // Case-insensitive pre-check for a friendly message. This is *not* redundant with the unique-
  // constraint catch below: `players.name`'s unique index is case-sensitive, so without this check
  // a rename to "bob" would slip through even with an existing "Bob" — the constraint only catches
  // an exact-case clash. The catch below remains the backstop against a race with this check.
  const { data: clash } = await supabaseAdmin
    .from('players')
    .select('id')
    .ilike('name', next)
    .neq('id', playerId)
    .maybeSingle();
  if (clash) {
    return NextResponse.json({ error: 'That name is already taken.' }, { status: 409 });
  }

  const { error: updateError } = await supabaseAdmin
    .from('players')
    .update({ name: next })
    .eq('id', playerId);
  if (updateError) {
    if ((updateError as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'That name is already taken.' }, { status: 409 });
    }
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await recordNameChange(supabaseAdmin, playerId, previousName, next);

  return NextResponse.json({ ok: true, player: { id: playerId, name: next } });
}
