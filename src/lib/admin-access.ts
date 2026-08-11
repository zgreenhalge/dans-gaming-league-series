// Shared session gate for admin-only mutations that aren't scoped to a specific match (unlike
// `requireMatchAccess`, which also allows an in-match player). Used by the admin server-console
// routes.

import { getServerSession } from 'next-auth';
import { authOptions } from './authOptions';
import { isPlayerAdmin } from './queries';
import type { AccessResult } from './access-control';

export type AdminAccess = AccessResult<{ playerId: number }>;

export async function requireAdminAccess(): Promise<AdminAccess> {
  const session = await getServerSession(authOptions);
  const playerId = session?.user?.playerId;
  if (!playerId) return { ok: false, status: 401, error: 'Unauthorized' };
  if (!(await isPlayerAdmin(playerId))) return { ok: false, status: 403, error: 'Forbidden' };
  return { ok: true, playerId };
}
