import { NextResponse } from 'next/server';

export type SeasonKind = 'regular' | 'gauntlet';

/** Parses and validates a request's `kind` query param — shared by `GET /api/seasons/[id]/view`
 *  and `GET /api/seasons/[id]/stats`, the two lazy-fetch endpoints behind the season detail page's
 *  top tabs and its Stats/Advanced Stats sub-tabs, so the validation (and its error message) can't
 *  drift between them. Returns the parsed kind, or a ready-to-return 400 response if it's
 *  missing/invalid. */
export function parseSeasonKind(kindRaw: string | null): { kind: SeasonKind } | { error: NextResponse } {
  if (kindRaw !== 'regular' && kindRaw !== 'gauntlet') {
    return { error: NextResponse.json({ error: "kind must be 'regular' or 'gauntlet'" }, { status: 400 }) };
  }
  return { kind: kindRaw };
}
