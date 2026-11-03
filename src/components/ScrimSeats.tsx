// A scrim night's seats — the four a match needs, filled by its signups — and how full that makes it.
// The scrims calendar and the home page's Upcoming panel draw nights with these, so a night reads the
// same everywhere, beside `LeagueGameMark` for a league game. Plain components, usable from server
// and client components alike.

import { SCRIM_MATCH_SIZE } from '@/lib/scrim-matchmaking';
import type { ScrimCommitment } from '@/lib/scrim-schedule';

/** A night's definite and maybe signup counts. */
export function signupCounts(signups: { commitment: ScrimCommitment }[]): { definite: number; maybe: number } {
  const definite = signups.filter((s) => s.commitment === 'definite').length;
  return { definite, maybe: signups.length - definite };
}

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

/** How full a night is: `full` once `SCRIM_MATCH_SIZE` players are definite, `could-fill` when its
 *  maybes would get it there, otherwise `short`. */
export function nightFill(definite: number, maybe: number): 'full' | 'could-fill' | 'short' {
  if (definite >= SCRIM_MATCH_SIZE) return 'full';
  return definite + maybe >= SCRIM_MATCH_SIZE ? 'could-fill' : 'short';
}

/** Of a day's nights' signup counts, the one that speaks for the day: the most definite signups, then
 *  the most maybes. `null` for a day with no nights. */
export function leadNight(counts: { definite: number; maybe: number }[]): { definite: number; maybe: number } | null {
  return counts.reduce<{ definite: number; maybe: number } | null>(
    (best, c) => (best === null || c.definite > best.definite || (c.definite === best.definite && c.maybe > best.maybe) ? c : best),
    null,
  );
}

/** A day cell's border and fill for its lead night's `nightFill()`: green once full, amber dashes when
 *  its maybes could fill it, plain otherwise — the scrims calendar's and the home week strip's days. */
export const DAY_FILL_CLS = {
  full: 'bg-[var(--color-accent-green-bg)] border-[var(--color-accent-green-border)]',
  'could-fill': 'border-dashed border-[var(--color-accent-amber-border)]',
  short: 'border-[var(--color-border-tertiary)]',
} as const;

/** A league game's mark — a small diamond — wherever scrim nights and league games share a view,
 *  so the two read apart at a glance. */
export function LeagueGameMark() {
  return <span aria-hidden className="block w-[5px] h-[5px] rotate-45 bg-[var(--color-text-primary)] opacity-75" />;
}
