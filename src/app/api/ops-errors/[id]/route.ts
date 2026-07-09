import { NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';

const supabaseAdmin = getAdminClient();

/** Dismisses a single `ops_errors` row by its id — the admin has seen it and either fixed the
 * underlying issue or is choosing to ignore it. Applies to any entity type (season, match, player,
 * system) since they all share this one table. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminAccess();
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await params;
  const opsErrorId = Number(id);
  if (!Number.isFinite(opsErrorId)) {
    return NextResponse.json({ error: 'Invalid ops_errors ID' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from('ops_errors').delete().eq('id', opsErrorId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
