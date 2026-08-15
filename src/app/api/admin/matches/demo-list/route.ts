// List match ids with a demo uploaded to R2 (`<id>/game.dem`) — feeds the admin match console's
// per-match and bulk "reparse demo" actions.

import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { isPlayerAdmin } from '@/lib/queries';
import { listDemoMatchIds } from '@/lib/r2';

export async function GET() {
  const session = await requireSession();
  if (!session?.user?.playerId || !(await isPlayerAdmin(session.user.playerId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const matchIds = await listDemoMatchIds();
  return NextResponse.json({ matchIds });
}
