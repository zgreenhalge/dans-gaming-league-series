// Site-wide "is any match live right now" read, backing `LiveMatchTicker`. Public — same audience as
// the match page's own live score. This is only the initial/refresh read; the ticker subscribes to
// `live_match_score` directly for updates, the same way `MatchScoreHero` does for a single match.

import { NextResponse } from 'next/server';
import { getLiveTickerMatch } from '@/lib/queries';

export async function GET() {
  const ticker = await getLiveTickerMatch();
  return NextResponse.json({ ticker });
}
