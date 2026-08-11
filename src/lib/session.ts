import { cache } from 'react';
import { getServerSession, type Session } from 'next-auth';
import { authOptions } from './authOptions';

type GlobalWithTestSession = typeof globalThis & {
  __dgls_testSession?: { value: Session | null };
};

/**
 * Test-only: inject a fake session so every session read in this process — `getSession()` and
 * `requireSession()` alike — sees it instead of calling next-auth for real. Call with `undefined`
 * to restore real-session behavior. Not used by application code.
 */
export function __setTestSession(session: Session | null | undefined): void {
  const g = globalThis as GlobalWithTestSession;
  if (session === undefined) delete g.__dgls_testSession;
  else g.__dgls_testSession = { value: session };
}

async function resolveSession(): Promise<Session | null> {
  const g = globalThis as GlobalWithTestSession;
  if (g.__dgls_testSession) return g.__dgls_testSession.value;
  return getServerSession(authOptions);
}

/**
 * `getServerSession()`, deduped per request via React's `cache()`. Server components that need the
 * session independently of one another within the same request tree (e.g. `/admin`'s layout gate
 * and the page it wraps) would otherwise each pay their own round trip for an identical result.
 */
export const getSession = cache(resolveSession);

/**
 * Same as `getSession()` without React's per-render `cache()` — for API route handlers, which don't
 * render as components and so don't share that dedup scope. Route-scoped access gates
 * (`season-roster-access.ts` and siblings) call this instead of `getSession()`.
 */
export const requireSession = resolveSession;

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
