import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { saveManualDraft } from '@/lib/gauntlet-engine';
import type { DraftPod, DraftSlot } from '@/lib/gauntlet-draft';

const supabaseAdmin = getAdminClient();

function parseSlot(value: unknown): DraftSlot | null {
  if (!value || typeof value !== 'object') return null;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'empty') return { kind: 'empty' };
  if (kind === 'player') {
    const playerId = (value as { playerId?: unknown }).playerId;
    if (typeof playerId !== 'number' || !Number.isInteger(playerId)) return null;
    return { kind: 'player', playerId };
  }
  if (kind === 'advance') {
    const sourcePodKey = (value as { sourcePodKey?: unknown }).sourcePodKey;
    const ordinal = (value as { ordinal?: unknown }).ordinal;
    if (typeof sourcePodKey !== 'string' || typeof ordinal !== 'number' || !Number.isInteger(ordinal)) return null;
    return { kind: 'advance', sourcePodKey, ordinal };
  }
  return null;
}

function parsePod(value: unknown): DraftPod | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.key !== 'string') return null;
  if (v.persistedId !== null && typeof v.persistedId !== 'number') return null;
  if (v.advance_rule !== 'single' && v.advance_rule !== 'wildcard') return null;
  if (typeof v.is_final !== 'boolean') return null;
  if (typeof v.round_number !== 'number' || !Number.isInteger(v.round_number) || v.round_number < 1) return null;
  if (typeof v.pod_index !== 'number' || !Number.isInteger(v.pod_index) || v.pod_index < 0) return null;
  if (!Array.isArray(v.slots) || v.slots.length !== 4) return null;
  const slots = v.slots.map(parseSlot);
  if (slots.some((s) => s === null)) return null;

  return {
    key: v.key,
    persistedId: v.persistedId as number | null,
    materialized: false,
    round_number: v.round_number,
    pod_index: v.pod_index,
    advance_rule: v.advance_rule,
    is_final: v.is_final,
    slots: slots as DraftSlot[],
  };
}

/**
 * Saves the manual pod editor's (`GauntletPodEditor`) current draft — reconciles it against
 * whatever's already persisted for this season's gauntlet via `saveManualDraft()`, creating the
 * paired gauntlet season on the first save. The client submits the *entire* current draft (not a
 * diff); `saveManualDraft()` figures out what's new, changed, or removed by comparing against the
 * currently-persisted shape.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminAccess();
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await params;
  const regularSeasonId = Number(id);
  if (!Number.isFinite(regularSeasonId)) {
    return NextResponse.json({ error: 'Invalid season ID' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const start_date: string | null = (body as { start_date?: string | null })?.start_date ?? null;
  if (start_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
    return NextResponse.json({ error: 'Invalid date format (expected YYYY-MM-DD)' }, { status: 400 });
  }

  const rawPods = (body as { pods?: unknown })?.pods;
  if (!Array.isArray(rawPods)) {
    return NextResponse.json({ error: 'pods must be an array' }, { status: 400 });
  }
  const pods = rawPods.map(parsePod);
  if (pods.some((p) => p === null)) {
    return NextResponse.json({ error: 'One or more pods are malformed' }, { status: 400 });
  }

  let result;
  try {
    result = await saveManualDraft(supabaseAdmin, regularSeasonId, pods as DraftPod[], { startDate: start_date });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  switch (result.status) {
    case 'not-eligible':
      return NextResponse.json({ error: result.reason }, { status: 404 });
    case 'invalid':
      return NextResponse.json({ error: result.errors.join(' ') }, { status: 400 });
    case 'saved':
      return NextResponse.json({ gauntletSeasonId: result.gauntletSeasonId });
  }
}
