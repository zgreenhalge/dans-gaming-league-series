import Link from 'next/link';
import EmptyState from './EmptyState';
import { scrimNightHref } from '@/lib/crumbs';
import { formatNightDate } from '@/lib/scrim-schedule';
import type { PastScrimNight } from '@/lib/queries';

/** Past scrim nights, newest first, each linking to its night page. */
export function ScrimPastNights({ nights }: { nights: PastScrimNight[] }) {
  if (nights.length === 0) return <EmptyState message="No past nights yet." className="py-2" />;
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      {nights.map((n) => (
        <Link
          key={n.date}
          href={scrimNightHref(n.date)}
          className="lift-row flex items-center justify-between gap-4 px-4 py-3 border-b border-[var(--color-border-tertiary)] last:border-b-0"
        >
          <span className="font-display text-[15px] font-semibold">{formatNightDate(n.date)}</span>
          <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">
            {n.matches} {n.matches === 1 ? 'match' : 'matches'} · {n.players} players
          </span>
        </Link>
      ))}
    </div>
  );
}
