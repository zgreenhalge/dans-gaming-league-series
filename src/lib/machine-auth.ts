// Shared-secret gate for machine-authenticated routes (called by the Worker / game server, not a
// browser). Centralizes the constant-time compare + the "missing secret = fail closed" handling so
// every machine endpoint behaves identically. The session-based equivalent is `requireMatchAccess`.

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

/** Constant-time compare of a provided secret against the expected one. */
export function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false; // timingSafeEqual throws on length mismatch
  return timingSafeEqual(a, b);
}

/**
 * Guard a machine route by shared secret. Returns a `NextResponse` to return on failure (503 when
 * the secret isn't configured — fail closed; 401 when the header doesn't match), or `null` on
 * success so the caller proceeds.
 */
export function machineSecretGuard(
  provided: string | null,
  expected: string | undefined,
  notConfiguredMessage: string,
): NextResponse | null {
  if (!expected) {
    return NextResponse.json({ error: notConfiguredMessage }, { status: 503 });
  }
  if (!secretsMatch(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
