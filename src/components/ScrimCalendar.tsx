'use client';

import { useMemo, useState } from 'react';
import EmptyState from './EmptyState';
import { ScrimNightPanel } from './ScrimNightPanel';
import { ScrimPastNights } from './ScrimPastNights';
import { StartScrimNightForm } from './StartScrimNightForm';
import { SkeletonBar } from './Skeleton';
import { ADMIN_SMALL_BUTTON_CLS } from './adminButtonStyles';
import { useHasMounted } from './useHasMounted';
import { addMonths, localDayKey, monthGrid } from '@/lib/calendar-month';
import { SCRIM_MAX_DAYS_AHEAD } from '@/lib/scrim-schedule';
import { SCRIM_MATCH_SIZE } from '@/lib/scrim-matchmaking';
import type { PastScrimNight, UpcomingScrimNight } from '@/lib/queries';

interface Props {
  upcoming: UpcomingScrimNight[];
  past: PastScrimNight[];
  currentPlayerId: number | null;
  isAdmin: boolean;
  allPlayers: { id: number; name: string }[];
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const LABEL_CLS = 'tracked text-[10px] text-[var(--color-text-secondary)]';
const DAY_MS = 24 * 60 * 60 * 1000;

/** The scrims calendar: a month grid in the viewer's own timezone where each day shows its nights —
 *  upcoming ones as four seats filled by their signups (filled definite, hollow maybe), the day green
 *  once a night is full and dashed amber when its maybes could fill it, past ones marked played — and,
 *  under it, the picked day's nights: an upcoming night's signup panel (`ScrimNightPanel`), a past
 *  night's results link, and the form to start a night that day. Opens on the soonest upcoming
 *  night's day, or today. Renders only in the browser, since its days depend on the viewer's timezone. */
export function ScrimCalendar(props: Props) {
  const mounted = useHasMounted();
  if (!mounted) return <SkeletonBar className="h-[360px] w-full" />;
  return <CalendarBody {...props} />;
}

function CalendarBody({ upcoming, past, currentPlayerId, isAdmin, allPlayers }: Props) {
  // The viewer's today, and the last day a night can start, read once when the calendar mounts.
  const [{ today, lastStartDay }] = useState(() => {
    const now = new Date();
    return { today: localDayKey(now), lastStartDay: localDayKey(new Date(now.getTime() + SCRIM_MAX_DAYS_AHEAD * DAY_MS)) };
  });
  const dayOf = (iso: string) => localDayKey(new Date(iso));

  const byDay = useMemo(() => {
    const map = new Map<string, { upcoming: UpcomingScrimNight[]; past: PastScrimNight[] }>();
    const entry = (day: string) => map.get(day) ?? (map.set(day, { upcoming: [], past: [] }), map.get(day)!);
    for (const u of upcoming) entry(dayOf(u.night.startsAt)).upcoming.push(u);
    for (const p of past) entry(dayOf(p.startsAt)).past.push(p);
    return map;
  }, [upcoming, past]);

  const [selected, setSelected] = useState(() => (upcoming[0] ? dayOf(upcoming[0].night.startsAt) : today));
  const [shown, setShown] = useState(() => {
    const [y, m] = selected.split('-').map(Number);
    return { year: y, month: m - 1 };
  });
  const weeks = monthGrid(shown.year, shown.month);
  const monthLabel = new Date(shown.year, shown.month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const day = byDay.get(selected) ?? { upcoming: [], past: [] };
  const canStartOnDay = selected >= today && selected <= lastStartDay;

  return (
    <div className="flex flex-col gap-6">
      <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] p-3 sm:p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <button type="button" onClick={() => setShown(addMonths(shown, -1))} aria-label="Previous month" className={ADMIN_SMALL_BUTTON_CLS}>
            ‹
          </button>
          <div className="font-display text-[16px] font-semibold">{monthLabel}</div>
          <button type="button" onClick={() => setShown(addMonths(shown, 1))} aria-label="Next month" className={ADMIN_SMALL_BUTTON_CLS}>
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((w, i) => (
            <div key={i} className={`${LABEL_CLS} text-center pb-1`}>
              {w}
            </div>
          ))}
          {weeks.flat().map((key, i) =>
            key === null ? <div key={i} /> : <DayCell key={key} day={key} nights={byDay.get(key)} today={today} selected={key === selected} onPick={setSelected} />,
          )}
        </div>
      </div>

      <section className="flex flex-col gap-4">
        <div className={LABEL_CLS}>
          {new Date(`${selected}T00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
        {day.upcoming.map((u) => (
          <ScrimNightPanel key={u.night.id} upcoming={u} currentPlayerId={currentPlayerId} isAdmin={isAdmin} allPlayers={allPlayers} showNightLink />
        ))}
        {day.past.length > 0 && <ScrimPastNights nights={day.past} />}
        {day.upcoming.length === 0 && day.past.length === 0 && (
          <EmptyState message={canStartOnDay ? 'No scrims this day yet.' : 'No scrims this day.'} className="py-1" />
        )}
        {canStartOnDay &&
          (currentPlayerId != null ? (
            <StartScrimNightForm key={selected} playerId={currentPlayerId} day={selected} />
          ) : (
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
              {/* A Route Handler that 302s to Steam, not an app page (see TopbarShell). */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/api/auth/steam" className="underline hover:text-[var(--color-text-primary)]">Log in</a> to start or sign up for a night.
            </div>
          ))}
      </section>
    </div>
  );
}

/** A night's seats: the four a match needs (`SCRIM_MATCH_SIZE`), filled in signup order — a filled
 *  person per definite, a hollow one per maybe — with the seats still open drawn dotted and anyone
 *  past the fourth as `+N`. Decorative — the cell's label carries the counts. */
function Seats({ definite, maybe }: { definite: number; maybe: number }) {
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

type SeatKind = 'definite' | 'maybe' | 'open';

/** A generic person — head and shoulders: filled for a definite signup, a hollow outline for a maybe,
 *  a faint dotted outline for an open seat. */
function PersonIcon({ kind }: { kind: SeatKind }) {
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
function nightFill(definite: number, maybe: number): 'full' | 'could-fill' | 'short' {
  if (definite >= SCRIM_MATCH_SIZE) return 'full';
  return definite + maybe >= SCRIM_MATCH_SIZE ? 'could-fill' : 'short';
}

const FILL_CLS = {
  full: 'bg-[var(--color-accent-green-bg)] border-[var(--color-accent-green-border)]',
  'could-fill': 'border-dashed border-[var(--color-accent-amber-border)]',
  short: 'border-[var(--color-border-tertiary)]',
} as const;

/** One day of the grid: its date and, for a day with an upcoming night, that night's seats (`Seats`) —
 *  the whole day tinted green once they're all definite, or bordered in amber dashes when its maybes
 *  could fill them — or a played mark for a past night. On a day with two nights, the one with the
 *  most definite signups speaks for the day. */
function DayCell({
  day,
  nights,
  today,
  selected,
  onPick,
}: {
  day: string;
  nights: { upcoming: UpcomingScrimNight[]; past: PastScrimNight[] } | undefined;
  today: string;
  selected: boolean;
  onPick: (day: string) => void;
}) {
  const counts = (nights?.upcoming ?? []).map((u) => {
    const definite = u.signups.filter((s) => s.commitment === 'definite').length;
    return { definite, maybe: u.signups.length - definite };
  });
  const lead = counts.reduce<{ definite: number; maybe: number } | null>(
    (best, c) => (best === null || c.definite > best.definite || (c.definite === best.definite && c.maybe > best.maybe) ? c : best),
    null,
  );
  const definite = counts.reduce((sum, c) => sum + c.definite, 0);
  const maybe = counts.reduce((sum, c) => sum + c.maybe, 0);
  const hasPast = (nights?.past.length ?? 0) > 0;
  const fill = lead ? nightFill(lead.definite, lead.maybe) : 'short';
  const title = [
    lead && `${counts.length} upcoming · ${definite} definite, ${maybe} maybe${fill === 'full' ? ' · full' : ''}`,
    hasPast && `${nights!.past.length} played`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      type="button"
      onClick={() => onPick(day)}
      aria-pressed={selected}
      aria-label={`${day}${title ? ` — ${title}` : ''}`}
      title={title || undefined}
      className={`relative flex flex-col items-center justify-start gap-0.5 min-h-[56px] sm:min-h-[64px] pt-1 border transition-colors ${FILL_CLS[fill]} ${
        selected ? 'outline outline-2 -outline-offset-2 outline-[var(--color-site-accent)]' : fill === 'full' ? 'hover:brightness-105' : 'hover:bg-[var(--color-bg-secondary)]'
      } ${day < today && !hasPast ? 'text-[var(--color-text-secondary)] opacity-60' : ''}`}
    >
      <span className={`font-mono text-[12px] ${day === today ? 'font-bold text-[var(--color-site-accent)]' : ''}`}>{Number(day.slice(8))}</span>
      {lead && <Seats definite={lead.definite} maybe={lead.maybe} />}
      {!lead && hasPast && <span className="font-mono text-[10px] leading-none text-[var(--color-text-secondary)]">played</span>}
    </button>
  );
}
