import { NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';

const supabaseAdmin = getAdminClient();

/** Dismisses a season's `ops_error` — the admin has seen it and either fixed the underlying issue
 * or is choosing to ignore it. Works for either a regular or gauntlet season row directly. */
export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminAccess();
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) {
    return NextResponse.json({ error: 'Invalid season ID' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('seasons')
    .update({ ops_error: null, ops_error_at: null })
    .eq('id', seasonId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
