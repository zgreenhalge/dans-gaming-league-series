// Read-only config-set diff for the admin console: compares a Supabase-backed config set (default
// `golden`, the production baseline) against what's live on the DGLS match server — scalar
// `server`/`cs2_settings` fields plus every cfg file, cvar-by-cvar. Makes no changes.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { dathostServerId } from '@/lib/dathost';
import { diffConfigSet } from '@/lib/dathost-config';

export async function GET(req: NextRequest) {
  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const configSet = req.nextUrl.searchParams.get('configSet') || 'golden';

  try {
    const diff = await diffConfigSet(getAdminClient(), dathostServerId(), configSet);
    return NextResponse.json(diff);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Diff failed' },
      { status: 502 },
    );
  }
}
