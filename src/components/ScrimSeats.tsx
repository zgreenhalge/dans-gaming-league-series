// A scrim night's seats — the four a match needs, filled by its signups — and the day fill that goes
// with them (counts and fill: `src/lib/scrim-seats.ts`).
// The scrims calendar and the home page's Upcoming panel draw nights with these, so a night reads the
// same everywhere, beside `LeagueGameMark` for a league game. Plain components, usable from server
// and client components alike.

import { SCRIM_MATCH_SIZE } from '@/lib/scrim-schedule';
import type { NightFill } from '@/lib/scrim-seats';

/** A night's seats: the four a match needs (`SCRIM_MATCH_SIZE`), filled in signup order — a filled
 *  person per definite, a hollow one per maybe — with the seats still open drawn dotted and anyone
 *  past the fourth as `+N`. Decorative — the cell's label carries the counts. */
export function Seats({ definite, maybe }: { definite: number; maybe: number }) {
  const kinds: SeatKind[] = [...Array<SeatKind>(definite).fill('definite'), ...Array<SeatKind>(maybe).fill('maybe')];
  const seats = kinds.slice(0, SCRIM_MATCH_SIZE);
  while (seats.length < SCRIM_MATCH_SIZE) seats.push('open');
  const rest = kinds.length - SCRIM_MATCH_SIZE;
  return (
    <span aria-hidden className="flex flex-col items-center gap-0.5">
      <span className="grid grid-cols-2 gap-px text-[var(--color-site-accent)]">
        {seats.map((kind, i) => (
          <PersonIcon key={i} kind={kind} />
        ))}
      </span>
      {rest > 0 && <span className="font-mono text-[10px] leading-none text-[var(--color-text-secondary)]">+{rest}</span>}
    </span>
  );
}

export type SeatKind = 'definite' | 'maybe' | 'open';

/** A generic person — head and shoulders: filled for a definite signup, a hollow outline for a maybe,
 *  a faint dotted outline for an open seat. */
export function PersonIcon({ kind }: { kind: SeatKind }) {
  const open = kind === 'open';
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" className={open ? 'text-[var(--color-text-secondary)] opacity-60' : undefined}>
      <g
        fill={kind === 'definite' ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={kind === 'definite' ? 0 : 1.2}
        strokeDasharray={open ? '1.2 1.1' : undefined}
      >
        <circle cx="6" cy="3.6" r="2.4" />
        <path d="M1.6 11.2a4.4 4.1 0 0 1 8.8 0Z" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/** A day cell's border and fill for its lead night's `nightFill()` (`src/lib/scrim-seats.ts`): green once full, amber dashes when
 *  its maybes could fill it, plain otherwise — the scrims calendar's and the home week strip's days. */
export const DAY_FILL_CLS: Record<NightFill, string> = {
  full: 'bg-[var(--color-accent-green-bg)] border-[var(--color-accent-green-border)]',
  'could-fill': 'border-dashed border-[var(--color-accent-amber-border)]',
  short: 'border-[var(--color-border-tertiary)]',
};

/** A league game's mark — a small diamond — wherever scrim nights and league games share a view,
 *  so the two read apart at a glance. */
export function LeagueGameMark() {
  return <span aria-hidden className="block w-[5px] h-[5px] rotate-45 bg-[var(--color-text-primary)] opacity-75" />;
}
