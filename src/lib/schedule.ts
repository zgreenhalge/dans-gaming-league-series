// Scheduling-collision detection for the single shared DatHost server (#134). Two matches whose
// scheduled times fall within the window contend for the one server. Shared by the schedule editor
// (MatchHeaderSection) and the match-page overlap banner so both agree on the boundary and can name
// the conflicting match.

/** A schedulable match's identity + time, enough to detect a clash and link to it. */
export interface ScheduledMatchRef {
  id: number;
  scheduledAt: string; // ISO
  label: string; // e.g. "Season 4 · Wk 3 · Match 2"
}

/** Matches strictly closer than this share the server and may contend. */
export const SCHEDULE_COLLISION_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * The other scheduled match **strictly** within the collision window of `whenIso` (nearest first if
 * several), or `null`. Strict (`<`, not `<=`) so games spaced exactly an hour apart do NOT collide —
 * only closer ones do. `whenIso` accepts an ISO string or a `datetime-local` value (both parse via
 * `Date`).
 */
export function findScheduleCollision(
  whenIso: string | null,
  others: ScheduledMatchRef[],
  windowMs: number = SCHEDULE_COLLISION_WINDOW_MS,
): ScheduledMatchRef | null {
  if (!whenIso) return null;
  const t = new Date(whenIso).getTime();
  if (Number.isNaN(t)) return null;
  let best: ScheduledMatchRef | null = null;
  let bestDelta = Infinity;
  for (const other of others) {
    const o = new Date(other.scheduledAt).getTime();
    if (Number.isNaN(o)) continue;
    const delta = Math.abs(o - t);
    if (delta < windowMs && delta < bestDelta) {
      best = other;
      bestDelta = delta;
    }
  }
  return best;
}
