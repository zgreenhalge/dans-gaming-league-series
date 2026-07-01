// Persistent notice on a match page when its scheduled time overlaps another match within the
// shared-server window (#134). Rendered like the Match-of-the-Week banner, in the same slot.
// Server-safe (no interactivity) — visibility is decided by the page from `findScheduleCollision`.

export function SchedulingOverlapBanner() {
  return (
    <div className="rounded font-semibold text-center mb-6 px-4 py-2 border border-[var(--color-accent-amber-border)] bg-[var(--color-accent-amber-bg)] text-[var(--color-accent-amber-fg)] select-none">
      ⚠ Another match is scheduled within an hour — they share one game server and may contend.
    </div>
  );
}
