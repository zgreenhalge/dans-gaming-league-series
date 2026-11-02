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
 *  upcoming ones as a pawn per signup (solid definite, dashed maybe), past ones marked played — and,
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

/** How many pawns a day cell draws before the rest fold into a `+N`. */
const MAX_PAWNS = 6;

/** Who's coming as pawns: a solid one per definite signup, then a dashed outline per maybe, up to
 *  `MAX_PAWNS` with the rest as `+N`. Decorative — the cell's label carries the counts. */
function Pawns({ definite, maybe }: { definite: number; maybe: number }) {
  const kinds = [...Array<boolean>(definite).fill(true), ...Array<boolean>(maybe).fill(false)];
  const shown = kinds.slice(0, MAX_PAWNS);
  const rest = kinds.length - shown.length;
  return (
    <span aria-hidden className="flex flex-wrap justify-center items-end gap-px px-0.5 text-[var(--color-site-accent)]">
      {shown.map((solid, i) => (
        <Pawn key={i} solid={solid} />
      ))}
      {rest > 0 && <span className="font-mono text-[9px] leading-none text-[var(--color-text-secondary)]">+{rest}</span>}
    </span>
  );
}

/** A pawn silhouette: solid for a definite signup, a dashed outline for a maybe. */
function Pawn({ solid }: { solid: boolean }) {
  return (
    <svg viewBox="0 0 10 14" width="7" height="10">
      <path
        d="M5 1.2a2.1 2.1 0 1 1 0 4.2a2.1 2.1 0 1 1 0-4.2ZM3.6 6.2h2.8l1 4.3H2.6ZM1.4 10.8h7.2v2H1.4Z"
        fill={solid ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={solid ? 0 : 0.9}
        strokeDasharray={solid ? undefined : '1.4 0.9'}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** One day of the grid: its date, a pawn per player coming to its upcoming nights (`Pawns`), or a
 *  played mark for a past one. */
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
  const signups = nights?.upcoming.flatMap((u) => u.signups) ?? [];
  const definite = signups.filter((s) => s.commitment === 'definite').length;
  const maybe = signups.length - definite;
  const hasUpcoming = (nights?.upcoming.length ?? 0) > 0;
  const hasPast = (nights?.past.length ?? 0) > 0;
  const title = [
    hasUpcoming && `${nights!.upcoming.length} upcoming · ${definite} definite, ${maybe} maybe`,
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
      className={`relative flex flex-col items-center justify-start gap-0.5 min-h-[48px] sm:min-h-[56px] pt-1 border transition-colors ${
        selected
          ? 'border-[var(--color-site-accent)] bg-[var(--color-bg-secondary)]'
          : 'border-[var(--color-border-tertiary)] hover:bg-[var(--color-bg-secondary)]'
      } ${day < today && !hasPast ? 'text-[var(--color-text-secondary)] opacity-60' : ''}`}
    >
      <span className={`font-mono text-[12px] ${day === today ? 'font-bold text-[var(--color-site-accent)]' : ''}`}>{Number(day.slice(8))}</span>
      {hasUpcoming && <Pawns definite={definite} maybe={maybe} />}
      {!hasUpcoming && hasPast && <span className="font-mono text-[10px] leading-none text-[var(--color-text-secondary)]">played</span>}
    </button>
  );
}
