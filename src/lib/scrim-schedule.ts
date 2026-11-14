// Scrim night timing. A night is a `scrim_nights` row with a start instant, created by its first
// signup and removed when its last player drops out (see `scrim-nights.ts`). Pure — every function
// takes `now` and the rows as arguments, so the clock and the database stay at the edges.

import type { ScheduledMatchRef } from './server-schedule-collision';

export type ScrimCommitment = 'definite' | 'maybe';

export const SCRIM_COMMITMENTS: readonly ScrimCommitment[] = ['definite', 'maybe'];

/** Players a scrim match needs. Here rather than in `scrim-matchmaking.ts` so the seats drawn on
 *  the calendar and the home page don't pull the matchmaker into the browser. */
export const SCRIM_MATCH_SIZE = 4;

/** A scrim night: its `scrim_nights` id, start instant (ISO 8601), the instant a player or admin ended
 *  it, if one did (`endScrimNight()`), and its latest activity (`last_active_at`), if any. */
export interface ScrimNight {
  id: number;
  startsAt: string;
  endedAt?: string | null;
  lastActiveAt?: string | null;
}

/** How long a night runs without a match starting or being scored before it ends on its own. Activity
 *  is a match's server going `provisioning` or `live` and a live round or final score — stamped on
 *  `scrim_nights.last_active_at` by triggers, and `scrim_night_end()` in the migrations measures idle
 *  the same way. */
export const SCRIM_NIGHT_IDLE_MS = 60 * 60 * 1000;

/** How long after its start a night counts as that night: an ended night can be reopened within it
 *  (`canReopenScrimNight()`), and the league matches in it show on the night (`leagueMatchesDuring()`). */
export const SCRIM_NIGHT_SPAN_MS = 12 * 60 * 60 * 1000;

/** How long before a night starts players can check in. Check-in stays open until the night ends. */
export const SCRIM_CHECK_IN_LEAD_MS = 30 * 60 * 1000;

/** The instant `night` ends, in epoch ms: `endedAt` (never before it started), else
 *  `SCRIM_NIGHT_IDLE_MS` after its latest activity — its start, or `lastActiveAt` if later. For a night
 *  that hasn't ended, the instant it would if nothing more happened. Its slot on the one shared server
 *  runs from `startsAt` to here, and `start_scrim_night()` measures the slot the same way. */
export function scrimNightEnd(night: ScrimNight): number {
  const start = Date.parse(night.startsAt);
  if (night.endedAt) return Math.max(start, Date.parse(night.endedAt));
  const lastActive = night.lastActiveAt ? Date.parse(night.lastActiveAt) : start;
  return Math.max(start, lastActive) + SCRIM_NIGHT_IDLE_MS;
}

/** Whether `night` is over: ended by hand, or idle for `SCRIM_NIGHT_IDLE_MS` (`scrimNightEnd()`). */
export function hasScrimNightEnded(night: ScrimNight, now: Date): boolean {
  if (night.endedAt) return true;
  return scrimNightEnd(night) <= now.getTime();
}

/** Whether `night` can be reopened: it is over, and still within `SCRIM_NIGHT_SPAN_MS` of its start. */
export function canReopenScrimNight(night: ScrimNight, now: Date): boolean {
  return hasScrimNightEnded(night, now) && now.getTime() < Date.parse(night.startsAt) + SCRIM_NIGHT_SPAN_MS;
}

/** Whether `night` has started (it may also have ended). */
export function hasScrimNightStarted(night: ScrimNight, now: Date): boolean {
  return Date.parse(night.startsAt) <= now.getTime();
}

/** The instant check-in opens for `night`, in epoch ms: `SCRIM_CHECK_IN_LEAD_MS` before it starts. */
export function scrimCheckInOpensAt(night: ScrimNight): number {
  return Date.parse(night.startsAt) - SCRIM_CHECK_IN_LEAD_MS;
}

/** Whether players can check in to `night`: from `scrimCheckInOpensAt()` until it ends. */
export function isScrimCheckInOpen(night: ScrimNight, now: Date): boolean {
  return scrimCheckInOpensAt(night) <= now.getTime() && !hasScrimNightEnded(night, now);
}

/** The instants, in epoch ms, where `night`'s clock checks flip: check-in opens
 *  (`isScrimCheckInOpen()`), it starts (`hasScrimNightStarted()`), it ends (`hasScrimNightEnded()`) and
 *  it can no longer be reopened (`canReopenScrimNight()`).
 *  A page that renders those checks refreshes at the next one (`nextRefreshInstant()`, `util.ts`). */
export function scrimNightBoundaries(night: ScrimNight): number[] {
  return [scrimCheckInOpensAt(night), Date.parse(night.startsAt), scrimNightEnd(night), Date.parse(night.startsAt) + SCRIM_NIGHT_SPAN_MS];
}

/** How far from a scheduled league match a scrim match can't start: a DGLS wingman game runs about
 *  20 minutes, and a league match always gets the one shared server. */
export const SCRIM_LEAGUE_CLEARANCE_MS = 30 * 60 * 1000;

/** The scheduled league matches that fall in `night` — from `SCRIM_LEAGUE_CLEARANCE_MS` before it
 *  starts until `SCRIM_NIGHT_SPAN_MS` after — soonest first: the server breaks the lobby shows. */
export function leagueMatchesDuring(night: ScrimNight, matches: ScheduledMatchRef[]): ScheduledMatchRef[] {
  const start = Date.parse(night.startsAt) - SCRIM_LEAGUE_CLEARANCE_MS;
  const end = Date.parse(night.startsAt) + SCRIM_NIGHT_SPAN_MS;
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
