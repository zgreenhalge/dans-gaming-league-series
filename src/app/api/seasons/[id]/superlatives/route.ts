import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { requireSeasonFeedbackAdmin } from '@/lib/feedback-access';
import { getSuperlativePoll, isSuperlativePollLocked } from '@/lib/queries';
import { validateSuperlativeOrder, validateSuperlativeTitle } from '@/lib/survey';

const LOCKED = { error: 'Voting has opened — superlatives can no longer be changed' };

/** Adds a superlative (`{ title }`) to a season's vote, creating the vote (closed) if this is the
 *  first one. Every player who played the season can be nominated for it. Refused once voting has
 *  opened. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireSeasonFeedbackAdmin((await params).id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { seasonId } = access;

  const body = (await req.json().catch(() => null)) as { title?: unknown } | null;
  const title = validateSuperlativeTitle(body?.title);
  if (!title.ok) return NextResponse.json({ error: title.error }, { status: 400 });

  const poll = await getSuperlativePoll(seasonId);
  if (poll && (await isSuperlativePollLocked(poll))) return NextResponse.json(LOCKED, { status: 409 });
  if (!poll) {
    const { error: pollErr } = await getAdminClient()
      .from('superlative_polls')
      .upsert({ season_id: seasonId }, { onConflict: 'season_id', ignoreDuplicates: true });
    if (pollErr) return NextResponse.json({ error: pollErr.message }, { status: 500 });
  }
  if (poll?.superlatives.some((s) => s.title.toLowerCase() === title.value.toLowerCase())) {
    return NextResponse.json({ error: 'That superlative already exists' }, { status: 409 });
  }

  const position = Math.max(0, ...(poll?.superlatives.map((s) => s.position) ?? [])) + 1;
  const { data, error } = await getAdminClient()
    .from('superlatives')
    .insert({ season_id: seasonId, position, title: title.value })
    .select('id')
    .single();
  if (error) {
    const raced = (error as { code?: string }).code === '23505';
    return NextResponse.json({ error: raced ? 'Another superlative was added at the same time — try again' : error.message }, { status: raced ? 409 : 500 });
  }
  return NextResponse.json({ ok: true, superlative_id: data.id }, { status: 201 });
}

/** Removes a superlative (`{ superlative_id }`), refused once voting has opened. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireSeasonFeedbackAdmin((await params).id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { seasonId } = access;

  const body = (await req.json().catch(() => null)) as { superlative_id?: unknown } | null;
  const superlativeId = body?.superlative_id;
  if (typeof superlativeId !== 'number') return NextResponse.json({ error: 'superlative_id is required' }, { status: 400 });

  const poll = await getSuperlativePoll(seasonId);
  if (!poll?.superlatives.some((s) => s.id === superlativeId)) {
    return NextResponse.json({ error: 'Superlative not found' }, { status: 404 });
  }
  if (await isSuperlativePollLocked(poll)) return NextResponse.json(LOCKED, { status: 409 });

  const { error } = await getAdminClient().from('superlatives').delete().eq('id', superlativeId).eq('season_id', seasonId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** Reorders the season's superlatives (`{ order: [superlative_id, …] }`, every id once). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireSeasonFeedbackAdmin((await params).id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const { seasonId } = access;

  const body = (await req.json().catch(() => null)) as { order?: unknown } | null;
  const poll = await getSuperlativePoll(seasonId);
  if (!poll) return NextResponse.json({ error: 'This season has no superlatives' }, { status: 404 });
  const order = validateSuperlativeOrder(poll.superlatives.map((s) => s.id), body?.order);
  if (!order.ok) return NextResponse.json({ error: order.error }, { status: 400 });
  if (await isSuperlativePollLocked(poll)) return NextResponse.json(LOCKED, { status: 409 });

  const { error } = await getAdminClient().rpc('reorder_superlatives', { p_season_id: seasonId, p_order: order.value });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** Renames a superlative (`{ superlative_id, title }`) or opens/closes voting (`{ open: boolean }`).
 *  Renaming is refused once voting has opened. A vote with no superlatives can't be opened. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireSeasonFeedbackAdmin((await params).id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
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
    const { error } = await getAdminClient().from('superlatives').update({ title: title.value }).eq('id', target.id).eq('season_id', seasonId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (open && poll.superlatives.length === 0) {
    return NextResponse.json({ error: 'Add a superlative before opening the vote' }, { status: 400 });
  }

  const { error } = await getAdminClient().from('superlative_polls').update({ is_open: open === true }).eq('season_id', seasonId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
