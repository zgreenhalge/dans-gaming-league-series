import { NextResponse } from 'next/server';
import { SCRIM_MATCH_CHANGED_CODE, ScrimMatchChangedError, ScrimMatchConflictError } from './scrim-matches';

/** The 409 for a refused scrim match write, or `null` for any other error, which the caller answers
 *  with its own 500 (the same shape as `machine-auth.ts`'s guards). A match that moved on since the
 *  client loaded it carries `code: 'match_changed'`, which makes the client reload. */
export function scrimConflictResponse(err: unknown): NextResponse | null {
  // `ScrimMatchChangedError` extends `ScrimMatchConflictError`, so it is checked first.
  if (err instanceof ScrimMatchChangedError) {
    return NextResponse.json({ error: err.message, code: SCRIM_MATCH_CHANGED_CODE }, { status: 409 });
  }
  if (err instanceof ScrimMatchConflictError) return NextResponse.json({ error: err.message }, { status: 409 });
  return null;
}
