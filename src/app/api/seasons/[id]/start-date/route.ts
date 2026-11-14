import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { isDateOnly, parseRouteId } from '@/lib/util';
import { accessDenied } from '@/lib/access-control';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await requireAdminAccess();
  if (!access.ok) return accessDenied(access);

  const supabaseAdmin = getAdminClient();
  const { id } = await params;
  const seasonId = parseRouteId(id);
  if (seasonId === null) {
    return NextResponse.json({ error: 'Invalid season ID' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !('start_date' in body)) {
    return NextResponse.json({ error: 'Missing start_date' }, { status: 400 });
  }

  const start_date: unknown = body.start_date ?? null;

  if (start_date !== null && !isDateOnly(start_date)) {
    return NextResponse.json({ error: 'Invalid date format (expected YYYY-MM-DD)' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('seasons')
    .update({ start_date })
    .eq('id', seasonId)
    .select('id');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data?.length) {
    return NextResponse.json({ error: 'Season not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
