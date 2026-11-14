import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { requireSeasonFeedbackAdmin } from '@/lib/feedback-access';
import { setFeedbackOpen, SUPERLATIVES_LIFECYCLE } from '@/lib/feedback-lifecycle';
import { getSuperlativePoll, isSuperlativePollLocked } from '@/lib/queries';
import { validateSuperlativeOrder, validateSuperlativeTitle } from '@/lib/superlatives';
import { addSuperlative, removeSuperlative, renameSuperlative, reorderSuperlatives, SuperlativeRacedError } from '@/lib/superlative-writes';
import { accessDenied } from '@/lib/access-control';

const LOCKED = { error: 'Voting has opened — superlatives can no longer be changed' };

/** The 500 for a failed write, carrying the error's message. */
function writeFailed(err: unknown, fallback: string) {
  return NextResponse.json({ error: err instanceof Error ? err.message : fallback }, { status: 500 });
}

/** Adds a superlative (`{ title }`) to a season's vote, creating the vote (closed) if this is the
 *  first one. Every player who played the season can be nominated for it. Refused once voting has
 *  opened. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireSeasonFeedbackAdmin((await params).id);
  if (!access.ok) return accessDenied(access);
  const { seasonId } = access;

  const body = (await req.json().catch(() => null)) as { title?: unknown } | null;
  const title = validateSuperlativeTitle(body?.title);
  if (!title.ok) return NextResponse.json({ error: title.error }, { status: 400 });

  const poll = await getSuperlativePoll(seasonId);
  if (poll && (await isSuperlativePollLocked(poll))) return NextResponse.json(LOCKED, { status: 409 });
  if (poll?.superlatives.some((s) => s.title.toLowerCase() === title.value.toLowerCase())) {
    return NextResponse.json({ error: 'That superlative already exists' }, { status: 409 });
  }

  try {
    const superlativeId = await addSuperlative(getAdminClient(), seasonId, title.value, poll);
    return NextResponse.json({ ok: true, superlative_id: superlativeId }, { status: 201 });
  } catch (err) {
    if (err instanceof SuperlativeRacedError) return NextResponse.json({ error: err.message }, { status: 409 });
    return writeFailed(err, 'Adding the superlative failed');
  }
}

/** Removes a superlative (`{ superlative_id }`), refused once voting has opened. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireSeasonFeedbackAdmin((await params).id);
  if (!access.ok) return accessDenied(access);
  const { seasonId } = access;

  const body = (await req.json().catch(() => null)) as { superlative_id?: unknown } | null;
  const superlativeId = body?.superlative_id;
  if (typeof superlativeId !== 'number') return NextResponse.json({ error: 'superlative_id is required' }, { status: 400 });

  const poll = await getSuperlativePoll(seasonId);
  if (!poll?.superlatives.some((s) => s.id === superlativeId)) {
    return NextResponse.json({ error: 'Superlative not found' }, { status: 404 });
  }
  if (await isSuperlativePollLocked(poll)) return NextResponse.json(LOCKED, { status: 409 });

  try {
    await removeSuperlative(getAdminClient(), seasonId, superlativeId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return writeFailed(err, 'Removing the superlative failed');
  }
}

/** Reorders the season's superlatives (`{ order: [superlative_id, …] }`, every id once). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireSeasonFeedbackAdmin((await params).id);
  if (!access.ok) return accessDenied(access);
  const { seasonId } = access;

  const body = (await req.json().catch(() => null)) as { order?: unknown } | null;
  const poll = await getSuperlativePoll(seasonId);
  if (!poll) return NextResponse.json({ error: 'This season has no superlatives' }, { status: 404 });
  const order = validateSuperlativeOrder(poll.superlatives.map((s) => s.id), body?.order);
  if (!order.ok) return NextResponse.json({ error: order.error }, { status: 400 });
  if (await isSuperlativePollLocked(poll)) return NextResponse.json(LOCKED, { status: 409 });

  try {
    await reorderSuperlatives(getAdminClient(), seasonId, order.value);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return writeFailed(err, 'Reordering the superlatives failed');
  }
}

/** Renames a superlative (`{ superlative_id, title }`) or opens/closes voting (`{ open: boolean }`).
 *  Renaming is refused once voting has opened. A vote with no superlatives can't be opened. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireSeasonFeedbackAdmin((await params).id);
  if (!access.ok) return accessDenied(access);
  const { seasonId } = access;

  const body = (await req.json().catch(() => null)) as { open?: unknown; superlative_id?: unknown; title?: unknown } | null;
  const renaming = body?.superlative_id !== undefined;
  const open = body?.open;
  if (!renaming && typeof open !== 'boolean') return NextResponse.json({ error: 'open must be a boolean' }, { status: 400 });

  const poll = await getSuperlativePoll(seasonId);
  if (!poll) return NextResponse.json({ error: 'Add a superlative first' }, { status: 404 });

  if (renaming) {
    const target = poll.superlatives.find((s) => s.id === body?.superlative_id);
    if (!target) return NextResponse.json({ error: 'Superlative not found' }, { status: 404 });
    const title = validateSuperlativeTitle(body?.title);
    if (!title.ok) return NextResponse.json({ error: title.error }, { status: 400 });
    if (await isSuperlativePollLocked(poll)) return NextResponse.json(LOCKED, { status: 409 });
    if (poll.superlatives.some((s) => s.id !== target.id && s.title.toLowerCase() === title.value.toLowerCase())) {
      return NextResponse.json({ error: 'That superlative already exists' }, { status: 409 });
    }
    try {
      await renameSuperlative(getAdminClient(), seasonId, target.id, title.value);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return writeFailed(err, 'Renaming the superlative failed');
    }
  }
  return setFeedbackOpen(SUPERLATIVES_LIFECYCLE, seasonId, open === true, poll);
}
