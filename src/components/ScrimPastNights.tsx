import Link from 'next/link';
import EmptyState from './EmptyState';
import { scrimNightHref } from '@/lib/crumbs';
import { LocalTime } from './LocalTime';
import type { PastScrimNight } from '@/lib/queries';

const DATE_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };

/** Past scrim nights, newest first, each linking to its night page. */
export function ScrimPastNights({ nights }: { nights: PastScrimNight[] }) {
  if (nights.length === 0) return <EmptyState message="No past nights yet." className="py-2" />;
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      {nights.map((n) => (
        <Link
          key={n.id}
          href={scrimNightHref(n.id)}
          className="lift-row flex items-center justify-between gap-4 px-4 py-3 border-b border-[var(--color-border-tertiary)] last:border-b-0"
        >
          <span className="font-display text-[15px] font-semibold"><LocalTime iso={n.startsAt} opts={DATE_FORMAT} /></span>
          <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">
            {n.matches} {n.matches === 1 ? 'match' : 'matches'} · {n.players} players
          </span>
        </Link>
      ))}
    </div>
  );
}
