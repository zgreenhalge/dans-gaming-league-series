// Read-only golden-config diff for the admin console's config-set management tool: compares the
// versioned config (`infra/matchzy/`) against what's live on the DGLS match server — scalar
// `server`/`cs2_settings` fields plus every cfg file, cvar-by-cvar. Makes no changes.

import { NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { dathostServerId } from '@/lib/dathost';
import { diffGoldenConfig } from '@/lib/dathost-config';

export async function GET() {
  const access = await requireAdminAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  try {
    const diff = await diffGoldenConfig(dathostServerId());
    return NextResponse.json(diff);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Diff failed' },
      { status: 502 },
    );
  }
}
