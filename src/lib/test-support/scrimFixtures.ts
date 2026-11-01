import type { Row } from './fakeSupabase';

/** A UTC weekly `scrim_schedule` row whose next night starts `offsetMs` from the real clock, and that
 *  night's date — for route tests, since the scrim routes read the clock themselves. */
export function scrimScheduleStartingIn(offsetMs: number): { row: Row; date: string } {
  const start = new Date(Date.now() + offsetMs);
  const hh = String(start.getUTCHours()).padStart(2, '0');
  const mm = String(start.getUTCMinutes()).padStart(2, '0');
  return {
    row: { id: 1, weekday: start.getUTCDay(), start_time: `${hh}:${mm}:00`, timezone: 'UTC', enabled: true },
    date: start.toISOString().slice(0, 10),
  };
}
