/**
 * Builds a `NextRequest` for exercising a `route.ts` handler directly in a test, without an actual
 * Next.js server. `req.json()` (used by every mutation route to read its body) works against the
 * result exactly as it would against a real incoming request.
 */

import { NextRequest } from 'next/server';

export function jsonRequest(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
