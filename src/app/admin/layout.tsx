import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { isPlayerAdmin } from '@/lib/queries';

/**
 * Single enforcement point for every route under `/admin/**` (#336) — individual pages no longer
 * repeat the `getServerSession` + `isPlayerAdmin` check themselves.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.user?.playerId) redirect('/');
  if (!(await isPlayerAdmin(session.user.playerId))) redirect('/');
  return children;
}
