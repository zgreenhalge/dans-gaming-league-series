import Link from 'next/link';
import { LocalTime } from './LocalTime';
import { AccentTag } from './AccentTag';
import type { ScrimOverview } from '@/lib/queries';

const START_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };

/** Home-page row for the next scrim night: when, how many are coming, and whether the viewer is in. */
export function NextScrimCard({
  overview,
  started,
  currentPlayerId,
}: {
  overview: ScrimOverview;
  started: boolean;
  currentPlayerId: number | null;
}) {
  const { next, signups } = overview;
  if (!next) return null;
  const definite = signups.filter((s) => s.commitment === 'definite').length;
  const maybe = signups.length - definite;
  const mine = signups.find((s) => s.player_id === currentPlayerId);

  return (
    <Link
      href="/scrims"
      className="lift-row mb-8 flex items-center justify-between gap-6 px-5 py-4 border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]"
    >
      <div className="min-w-0">
        <div className="tracked text-[9px] mb-0.5" style={{ color: 'var(--color-site-accent)' }}>
          {started ? 'Scrims · happening now' : 'Next scrims'}
        </div>
        <div className="font-display text-[18px] font-semibold leading-tight truncate">
          <LocalTime iso={next.startsAt} opts={START_FORMAT} />
        </div>
        <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-1">
          {definite} definite · {maybe} maybe
        </div>
      </div>
      <AccentTag>{mine ? (mine.commitment === 'definite' ? "You're in" : "You're a maybe") : 'Sign up'}</AccentTag>
    </Link>
  );
}
