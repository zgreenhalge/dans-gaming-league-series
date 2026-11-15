import { NextResponse } from 'next/server';

/** The 500 for a route's catch block: the thrown error's message, or the route's own `fallback` text
 *  when the rejection isn't an `Error`. Used for failed writes and for failed reads alike. */
export function internalError(err: unknown, fallback: string) {
  return NextResponse.json({ error: err instanceof Error ? err.message : fallback }, { status: 500 });
}
