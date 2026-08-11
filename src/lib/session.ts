import { cache } from 'react';
import { getServerSession } from 'next-auth';
import { authOptions } from './authOptions';

/**
 * `getServerSession()`, deduped per request via React's `cache()`. Server components that need the
 * session independently of one another within the same request tree (e.g. `/admin`'s layout gate
 * and the page it wraps) would otherwise each pay their own round trip for an identical result.
 */
export const getSession = cache(() => getServerSession(authOptions));

/**
 * The signed-in session's `playerId`. Only call this from a route that already sits behind another
 * gate guaranteeing a session exists — e.g. any page under `/admin/**`, whose `layout.tsx` redirects
 * unauthenticated/non-admin requests before the page itself ever renders — since this trusts that
 * guarantee (via a non-null assertion) rather than re-deriving and re-checking it.
 */
export async function sessionPlayerId(): Promise<number> {
  const session = await getSession();
  return session!.user!.playerId!;
}
