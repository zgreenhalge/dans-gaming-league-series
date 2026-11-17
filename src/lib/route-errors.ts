import { NextResponse } from 'next/server';
import { MatchNotFoundError } from './match-day';

/** The 500 for a route's catch block: the thrown error's message, or the route's own `fallback` text
 *  when the rejection isn't an `Error`. Used for failed writes and for failed reads alike. */
export function internalError(err: unknown, fallback: string) {
  return NextResponse.json({ error: err instanceof Error ? err.message : fallback }, { status: 500 });
}

/** The error response for a failed match-day write (`src/lib/match-day.ts`): a 404 when no match has the
 *  id, otherwise the 500 from `internalError()`. */
export function matchWriteError(err: unknown, fallback: string) {
  if (err instanceof MatchNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
  return internalError(err, fallback);
}
