// Scrim night timing. A night is a `scrim_nights` row with a start instant, created by its first
// signup and removed when its last player drops out (see `scrim-nights.ts`). Pure — every function
// takes `now` and the rows as arguments, so the clock and the database stay at the edges.

import { SHORT_DATE_FORMAT } from './util';
import type { ScheduledMatchRef } from './server-schedule-collision';

export type ScrimCommitment = 'definite' | 'maybe';

export const SCRIM_COMMITMENTS: readonly ScrimCommitment[] = ['definite', 'maybe'];

/** Players a scrim match needs. Here rather than in `scrim-matchmaking.ts` so the seats drawn on
 *  the calendar and the home page don't pull the matchmaker into the browser. */
export const SCRIM_MATCH_SIZE = 4;

/** A scrim night: its `scrim_nights` id, start instant (ISO 8601), and the instant a player or admin
 *  ended it early, if one did (`endScrimNight()`). */
export interface ScrimNight {
  id: number;
  startsAt: string;
  endedAt?: string | null;
}

/** How long a night runs after it starts unless it's ended sooner: signups and check-in stay open until
 *  this has passed, and no two nights may start closer together than this. */
export const SCRIM_NIGHT_LENGTH_MS = 4 * 60 * 60 * 1000;

/** How long before a night starts players can check in. Check-in stays open until the night ends. */
export const SCRIM_CHECK_IN_LEAD_MS = 30 * 60 * 1000;

/** The timezone server-rendered night labels use — the league's, as in `seo/og.ts`: the page title
 *  (until `LocalDateInTitle` swaps in the viewer's own date) and link previews (`formatNightStart()`). Breadcrumbs and in-page
 *  times render in the viewer's timezone (`Crumb.localDate`, `LocalTime`). */
const SCRIM_LABEL_TIMEZONE = 'America/New_York';

/** Whether `night` is over: ended by hand, or `SCRIM_NIGHT_LENGTH_MS` after it started. */
export function hasScrimNightEnded(night: ScrimNight, now: Date): boolean {
  if (night.endedAt) return true;
  return Date.parse(night.startsAt) + SCRIM_NIGHT_LENGTH_MS <= now.getTime();
}

/** Whether `night` has started (it may also have ended). */
export function hasScrimNightStarted(night: ScrimNight, now: Date): boolean {
  return Date.parse(night.startsAt) <= now.getTime();
}

/** Whether players can check in to `night`: from `SCRIM_CHECK_IN_LEAD_MS` before it starts until it
 *  ends. */
export function isScrimCheckInOpen(night: ScrimNight, now: Date): boolean {
  return Date.parse(night.startsAt) - SCRIM_CHECK_IN_LEAD_MS <= now.getTime() && !hasScrimNightEnded(night, now);
}

/** How far from a scheduled league match a scrim match can't start: a DGLS wingman game runs about
 *  20 minutes, and a league match always gets the one shared server. */
export const SCRIM_LEAGUE_CLEARANCE_MS = 30 * 60 * 1000;

/** The scheduled league matches that fall in `night` — from `SCRIM_LEAGUE_CLEARANCE_MS` before it
 *  starts until it ends — soonest first: the server breaks the lobby shows. */
export function leagueMatchesDuring(night: ScrimNight, matches: ScheduledMatchRef[]): ScheduledMatchRef[] {
  const start = Date.parse(night.startsAt) - SCRIM_LEAGUE_CLEARANCE_MS;
  const end = Date.parse(night.startsAt) + SCRIM_NIGHT_LENGTH_MS;
  return matches
    .filter((m) => {
      const t = Date.parse(m.scheduledAt);
      return t >= start && t < end;
    })
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

/** The nights that haven't ended, soonest first. */
export function upcomingScrimNights(nights: ScrimNight[], now: Date): ScrimNight[] {
  return nights.filter((n) => !hasScrimNightEnded(n, now)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** A night's date for a server-rendered label (`SHORT_DATE_FORMAT`, e.g. `Thu, Nov 5`), in
 *  `SCRIM_LABEL_TIMEZONE`. */
export function formatNightDate(startsAt: string): string {
  return new Date(startsAt).toLocaleDateString('en-US', { ...SHORT_DATE_FORMAT, timeZone: SCRIM_LABEL_TIMEZONE });
}

/** A night's start for a link preview, e.g. `Thu, Nov 5, 8:00 PM ET`, in `SCRIM_LABEL_TIMEZONE`
 *  and labelled so — a preview is read wherever it's shared, so it names its zone. */
export function formatNightStart(startsAt: string): string {
  const time = new Date(startsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: SCRIM_LABEL_TIMEZONE });
  return `${formatNightDate(startsAt)}, ${time} ET`;
}

/** How far ahead a night can be started. */
export const SCRIM_MAX_DAYS_AHEAD = 60;

/** Nights start on a multiple of this many minutes past the hour. Every timezone's UTC offset is a
 *  multiple of 15 minutes, so a local quarter hour is a UTC one too. */
export const SCRIM_START_STEP_MINUTES = 15;

/** Parses a new night's start from a request body value (an ISO 8601 instant), or returns why it's
 *  invalid. A night must start on a `SCRIM_START_STEP_MINUTES` step, and can't already be over or start
 *  more than `SCRIM_MAX_DAYS_AHEAD` days out. */
export function parseNightStart(value: unknown, now: Date): { ok: true; startsAt: string } | { ok: false; error: string } {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  if (Number.isNaN(ms)) return { ok: false, error: 'startsAt must be a date and time' };
  if (ms % (SCRIM_START_STEP_MINUTES * 60_000) !== 0) {
    return { ok: false, error: `A night starts on a ${SCRIM_START_STEP_MINUTES}-minute mark` };
  }
  const startsAt = new Date(ms).toISOString();
  if (hasScrimNightEnded({ id: 0, startsAt }, now)) return { ok: false, error: 'That night would already be over' };
  if (ms > now.getTime() + SCRIM_MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000) {
    return { ok: false, error: `A night can start at most ${SCRIM_MAX_DAYS_AHEAD} days ahead` };
  }
  return { ok: true, startsAt };
}

/** `value` as a commitment, or `null` if it isn't one. */
export function parseCommitment(value: unknown): ScrimCommitment | null {
  return SCRIM_COMMITMENTS.includes(value as ScrimCommitment) ? (value as ScrimCommitment) : null;
}
