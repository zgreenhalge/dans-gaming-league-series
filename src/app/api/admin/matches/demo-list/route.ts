// List match ids with a demo uploaded to R2 (`<id>/game.dem`) — feeds the admin match console's
// per-match and bulk "reparse demo" actions.

import { NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { accessDenied } from '@/lib/access-control';
import { listDemoMatchIds } from '@/lib/r2';

export async function GET() {
  const access = await requireAdminAccess();
  if (!access.ok) return accessDenied(access);
  const matchIds = await listDemoMatchIds();
  return NextResponse.json({ matchIds });
}
