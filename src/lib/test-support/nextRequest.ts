/**
 * Builds a `NextRequest` for exercising a `route.ts` handler directly in a test, without an actual
 * Next.js server. `req.json()` (used by every mutation route to read its body) works against the
 * result exactly as it would against a real incoming request.
 */

import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';

export function jsonRequest(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** A minimal next-auth `Session` carrying just the `playerId` the session-based access gates read,
 * for use with `__setTestSession()` (`src/lib/session.ts`). */
export function sessionFor(playerId: number): Session {
  return { user: { playerId }, expires: '2099-01-01T00:00:00.000Z' };
}
