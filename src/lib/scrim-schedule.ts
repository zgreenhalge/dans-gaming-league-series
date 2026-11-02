// Scrim night timing. A night is a `scrim_nights` row with a start instant, created by its first
// signup and removed when its last player drops out (see `scrim-nights.ts`). Pure — every function
// takes `now` and the rows as arguments, so the clock and the database stay at the edges.

export type ScrimCommitment = 'definite' | 'maybe';

export const SCRIM_COMMITMENTS: readonly ScrimCommitment[] = ['definite', 'maybe'];

/** A scrim night: its `scrim_nights` id and start instant (ISO 8601). */
export interface ScrimNight {
  id: number;
  startsAt: string;
}

/** How long a night runs after it starts: signups and check-in stay open until this has passed, and
 *  no two nights may start closer together than this. */
export const SCRIM_NIGHT_LENGTH_MS = 4 * 60 * 60 * 1000;

/** How long before a night starts players can check in. Check-in stays open until the night ends. */
export const SCRIM_CHECK_IN_LEAD_MS = 30 * 60 * 1000;

/** The timezone server-rendered night labels use — the league's, as in `seo/og.ts`: page titles, and
 *  breadcrumbs until they hydrate into the viewer's own timezone (`Crumb.localDate`). In-page times
 *  render in the viewer's timezone (`LocalTime`). */
const SCRIM_LABEL_TIMEZONE = 'America/New_York';

/** Whether `night` is over. */
export function hasScrimNightEnded(night: ScrimNight, now: Date): boolean {
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

/** The nights that haven't ended, soonest first. */
export function upcomingScrimNights(nights: ScrimNight[], now: Date): ScrimNight[] {
  return nights.filter((n) => !hasScrimNightEnded(n, now)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** A night's date for a server-rendered label, e.g. `Thu, Nov 5`, in `SCRIM_LABEL_TIMEZONE`. */
export function formatNightDate(startsAt: string): string {
  return new Date(startsAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: SCRIM_LABEL_TIMEZONE });
}

/** Parses a new night's start from a request body value (an ISO 8601 instant), or returns why it's
 *  invalid. A night that would already be over can't be started. */
export function parseNightStart(value: unknown, now: Date): { ok: true; startsAt: string } | { ok: false; error: string } {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  if (Number.isNaN(ms)) return { ok: false, error: 'startsAt must be a date and time' };
  const startsAt = new Date(ms).toISOString();
  if (hasScrimNightEnded({ id: 0, startsAt }, now)) return { ok: false, error: 'That night would already be over' };
  return { ok: true, startsAt };
}

/** `value` as a commitment, or `null` if it isn't one. */
export function parseCommitment(value: unknown): ScrimCommitment | null {
  return SCRIM_COMMITMENTS.includes(value as ScrimCommitment) ? (value as ScrimCommitment) : null;
}
