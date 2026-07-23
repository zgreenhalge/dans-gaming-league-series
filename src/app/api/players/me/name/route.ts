import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { getAdminClient } from '@/lib/supabase-admin';
import { recordNameChange } from '@/lib/player-name-history';
import { normalizePlayerName, isValidPlayerName, PLAYER_NAME_MIN_LENGTH, PLAYER_NAME_MAX_LENGTH } from '@/lib/util';

// Self-service rename (issue #268): a player changes their own display name, in place on their
// profile page. Distinct from the admin-only `PATCH /api/players/[id]` — that route can rename any
// player at any time; this one is scoped to the caller's own row, restricted to letters/spaces, and
// rate-limited to once every RENAME_COOLDOWN_MS.
//
// The cooldown is enforced by a single atomic conditional UPDATE against `players.name_changed_at`
// (not a separate read-then-write of `player_name_history`): Postgres row-locks the target row for
// the duration of the UPDATE, so of two concurrent requests, whichever commits first is the only
// one whose WHERE clause the second can still match — the second re-evaluates against the
// just-committed `name_changed_at` and finds the cooldown now active. A read-before-write cooldown
// check can't close that race; a conditional write can. `player_name_history` (via
// `recordNameChange()`) remains a pure audit trail, not the rate-limit's source of truth.

const supabaseAdmin = getAdminClient();

const RENAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

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

  const { data: current, error: fetchError } = await supabaseAdmin
    .from('players')
    .select('name')
    .eq('id', playerId)
    .maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

  const previousName = (current as { name: string }).name;
  if (next === previousName) {
    return NextResponse.json({ ok: true, player: { id: playerId, name: previousName } });
  }

  // Case-insensitive pre-check for a friendly message on the common (non-racing) path — the DB's
  // case-insensitive unique index on `lower(name)` is the real backstop, since `players.name`'s
  // plain unique index is case-sensitive and wouldn't by itself catch a "bob" vs. existing "Bob".
  const { data: clash } = await supabaseAdmin
    .from('players')
    .select('id')
    .ilike('name', next)
    .neq('id', playerId)
    .maybeSingle();
  if (clash) {
    return NextResponse.json({ error: 'That name is already taken.' }, { status: 409 });
  }

  const cutoffIso = new Date(Date.now() - RENAME_COOLDOWN_MS).toISOString();
  const nowIso = new Date().toISOString();

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('players')
    .update({ name: next, name_changed_at: nowIso })
    .eq('id', playerId)
    .or(`name_changed_at.is.null,name_changed_at.lte.${cutoffIso}`)
    .select('name')
    .maybeSingle();

  if (updateError) {
    if ((updateError as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'That name is already taken.' }, { status: 409 });
    }
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (!updated) {
    // The conditional UPDATE matched no row — the cooldown is active (either it always was, or a
    // concurrent request just won the race and reset it). Re-read to report an accurate date.
    const { data: recheck } = await supabaseAdmin
      .from('players')
      .select('name_changed_at')
      .eq('id', playerId)
      .maybeSingle();
    const lastChangedAt = (recheck as { name_changed_at?: string | null } | null)?.name_changed_at;
    if (!lastChangedAt) return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    const nextEligibleAt = new Date(new Date(lastChangedAt).getTime() + RENAME_COOLDOWN_MS);
    return NextResponse.json(
      { error: 'You can only change your name once a week.', nextEligibleAt: nextEligibleAt.toISOString() },
      { status: 429 },
    );
  }

  await recordNameChange(supabaseAdmin, playerId, previousName, next);

  return NextResponse.json({ ok: true, player: { id: playerId, name: next } });
}
