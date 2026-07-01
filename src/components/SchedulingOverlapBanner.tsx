// Persistent notice on a match page when its scheduled time overlaps another match within the
// shared-server window (#134). Rendered like the Match-of-the-Week banner, in the same slot.
// Server-safe (no interactivity) — visibility is decided by the page from `findScheduleCollision`.

import Link from 'next/link';
import type { ScheduledMatchRef } from '@/lib/schedule';

export function SchedulingOverlapBanner({ conflict }: { conflict: ScheduledMatchRef }) {
  return (
    <div className="rounded font-semibold text-center mb-6 px-4 py-2 border border-[var(--color-accent-amber-border)] bg-[var(--color-accent-amber-bg)] text-[var(--color-accent-amber-fg)] select-none">
      ⚠ Scheduled within an hour of{' '}
      <Link href={`/matches/${conflict.id}`} className="underline hover:opacity-80">
        {conflict.label}
      </Link>{' '}
      — they share one game server and may contend.
    </div>
  );
}
