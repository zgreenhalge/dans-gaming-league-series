// Scrim night scheduling: the admin-set weekly slot (`scrim_schedule`) expanded into concrete nights,
// merged with the per-date `scrim_nights` rows that record signups and cancellations. Pure — every
// function takes `now` and the rows as arguments, so the clock and the database stay at the edges.
//
// A night is identified by its calendar date in the schedule's timezone (`YYYY-MM-DD`), and starts at
// the schedule's `startTime` on that date. Dates and times are converted with `Intl` alone, so a
// night keeps its local wall-clock time across DST changes.

export type ScrimCommitment = 'definite' | 'maybe';

export const SCRIM_COMMITMENTS: readonly ScrimCommitment[] = ['definite', 'maybe'];

export interface ScrimSchedule {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Wall-clock start in `timezone`, `HH:MM` (24-hour). */
  startTime: string;
  /** IANA timezone name, e.g. `America/New_York`. */
  timezone: string;
  enabled: boolean;
}

/** A `scrim_nights` row. */
export interface ScrimNightRow {
  id: number;
  night_date: string;
  cancelled: boolean;
}

/** One concrete scrim night: a scheduled date, whether or not it has a `scrim_nights` row yet. */
export interface ScrimNightSlot {
  /** `YYYY-MM-DD` in the schedule's timezone. */
  date: string;
  /** The night's start instant, ISO 8601. */
  startsAt: string;
  /** The `scrim_nights` row id, or `null` while nobody has signed up or cancelled it. */
  nightId: number | null;
  cancelled: boolean;
}

/** How long a night stays current after it starts: signups stay open and it still counts as the next
 *  night until this has passed. */
export const SCRIM_NIGHT_LENGTH_MS = 4 * 60 * 60 * 1000;

/** How many weekly nights ahead `scrimNightSlots()` lists by default. */
export const SCRIM_NIGHTS_AHEAD = 4;

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Whether `date` is a real `YYYY-MM-DD` calendar date. */
export function isNightDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/** Whether `tz` is an IANA timezone name this runtime knows. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** `HH:MM` from a Postgres `time` value (`HH:MM:SS`) or an `HH:MM` string. */
export function normalizeStartTime(time: string): string {
  return time.slice(0, 5);
}

/** Milliseconds `tz` is ahead of UTC at `instant`. */
function zoneOffsetMs(instant: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wallAsUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant at which the wall clock in `tz` reads `date` `time`. */
export function zonedTimeToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // The offset at the wall time read as UTC can differ from the offset at the real instant when a DST
  // change falls between them, so correct once with the offset at the first guess.
  const guess = wall - zoneOffsetMs(wall, tz);
  return new Date(wall - zoneOffsetMs(guess, tz));
}

/** `instant`'s calendar date in `tz`, `YYYY-MM-DD`. */
export function dateInZone(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** When the night on `date` starts under `schedule`. */
export function scrimNightStart(schedule: ScrimSchedule, date: string): Date {
  return zonedTimeToUtc(date, schedule.startTime, schedule.timezone);
}

/**
 * The scrim nights that haven't ended yet, soonest first: the next `weeks` scheduled dates, plus any
 * `scrim_nights` row for another date that is still ahead (e.g. one signed up for before the weekday
 * changed). Cancelled nights are included, flagged, so an admin can restore them. Empty when there's
 * no schedule or it's disabled.
 */
export function scrimNightSlots(
  schedule: ScrimSchedule | null,
  nights: ScrimNightRow[],
  now: Date,
  weeks: number = SCRIM_NIGHTS_AHEAD,
): ScrimNightSlot[] {
  if (!schedule?.enabled) return [];
  const notEnded = (date: string) => scrimNightStart(schedule, date).getTime() + SCRIM_NIGHT_LENGTH_MS > now.getTime();

  // Start a day back: a late-evening night can still be running after midnight local time.
  let date = addDays(dateInZone(now, schedule.timezone), -1);
  while (weekdayOf(date) !== schedule.weekday) date = addDays(date, 1);
  const dates: string[] = [];
  for (; dates.length < weeks; date = addDays(date, 7)) {
    if (notEnded(date)) dates.push(date);
  }
  const scheduled = new Set(dates);
  for (const n of nights) {
    if (!scheduled.has(n.night_date) && notEnded(n.night_date)) dates.push(n.night_date);
  }

  const rowByDate = new Map(nights.map((n) => [n.night_date, n]));
  return dates
    .map((d) => {
      const row = rowByDate.get(d);
      return { date: d, startsAt: scrimNightStart(schedule, d).toISOString(), nightId: row?.id ?? null, cancelled: row?.cancelled ?? false };
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** The next night that isn't cancelled, or `null`. */
export function nextScrimNight(slots: ScrimNightSlot[]): ScrimNightSlot | null {
  return slots.find((s) => !s.cancelled) ?? null;
}

/** Whether `slot` has started (and, being a listed slot, not yet ended). */
export function hasScrimNightStarted(slot: ScrimNightSlot, now: Date): boolean {
  return Date.parse(slot.startsAt) <= now.getTime();
}

/** Parses a schedule from an admin request body, or returns why it's invalid. */
export function parseScrimScheduleInput(body: unknown): { ok: true; schedule: ScrimSchedule } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const { weekday, startTime, timezone, enabled } = b;
  if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return { ok: false, error: 'weekday must be an integer from 0 (Sunday) to 6 (Saturday)' };
  }
  if (typeof startTime !== 'string' || !TIME_RE.test(startTime)) {
    return { ok: false, error: 'startTime must be HH:MM (24-hour)' };
  }
  if (typeof timezone !== 'string' || !isValidTimezone(timezone)) {
    return { ok: false, error: 'timezone must be an IANA timezone name' };
  }
  if (typeof enabled !== 'boolean') return { ok: false, error: 'enabled must be a boolean' };
  return { ok: true, schedule: { weekday, startTime, timezone, enabled } };
}

/** `value` as a commitment, or `null` if it isn't one. */
export function parseCommitment(value: unknown): ScrimCommitment | null {
  return SCRIM_COMMITMENTS.includes(value as ScrimCommitment) ? (value as ScrimCommitment) : null;
}
