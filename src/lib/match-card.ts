// The right-hand status a `MatchCard` shows, and its derivation. A plain module (no 'use client') so
// server components — a scrim night's match list among them — can derive it; a function exported
// from the client `MatchCard.tsx` module is a client reference a server component can't call.

import { isPlayedScore } from './util';

export type MatchCardRight =
  | { type: 'score'; score: string }
  | { type: 'scheduled'; scheduledAt: string }
  | { type: 'week-window'; weekStart: Date; weekEnd: Date }
  | { type: 'pending' }
  | null;

/** A match's right-hand status: its score once played, else its scheduled time once set, else the
 *  caller's fallback (a week window for the regular season's ScheduleList, plain "pending" for
 *  GauntletRoundsList, none for a scrim night's match list). */
export function matchCardRight(finalScore: string | null, scheduledAt: string | null, fallback: MatchCardRight): MatchCardRight {
  if (isPlayedScore(finalScore)) return { type: 'score', score: finalScore! };
  if (scheduledAt) return { type: 'scheduled', scheduledAt };
  return fallback;
}
