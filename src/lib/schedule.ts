// Scheduling-collision detection for the single shared DatHost server (#134). Two matches whose
// scheduled times fall within the window contend for the one server. Shared by the schedule editor
// (MatchHeaderSection) and the match-page overlap banner so both agree on the boundary.

/** Matches strictly closer than this share the server and may contend. */
export const SCHEDULE_COLLISION_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * The nearest other scheduled time (ISO) **strictly** within the collision window of `whenIso`, or
 * `null`. Strict (`<`, not `<=`) so games spaced exactly an hour apart do NOT collide — only closer
 * ones do. `whenIso` accepts an ISO string or a `datetime-local` value (both parse via `Date`).
 */
export function findScheduleCollision(
  whenIso: string | null,
  others: string[],
  windowMs: number = SCHEDULE_COLLISION_WINDOW_MS,
): string | null {
  if (!whenIso) return null;
  const t = new Date(whenIso).getTime();
  if (Number.isNaN(t)) return null;
  for (const iso of others) {
    const o = new Date(iso).getTime();
    if (!Number.isNaN(o) && Math.abs(o - t) < windowMs) return iso;
  }
  return null;
}
