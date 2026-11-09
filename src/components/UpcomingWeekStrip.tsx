'use client';

import { useState } from 'react';
import { SkeletonBar } from './Skeleton';
import { useHasMounted } from './useHasMounted';
import { DAY_FILL_CLS, LeagueGameMark, Seats } from './ScrimSeats';
import { dayNightFill } from '@/lib/scrim-seats';
import { localDayKey } from '@/lib/calendar-month';
import type { UpcomingScrimNight } from '@/lib/queries';

/** How many league-game diamonds a day draws before the rest fold into a `+N`. */
const MAX_DIAMONDS = 3;
const DAYS = 7;

interface Props {
  /** When each scheduled league game starts (ISO). */
  gameTimes: string[];
  scrims: UpcomingScrimNight[];
}

/** The week ahead, today first, in the viewer's timezone: each day draws a diamond per league game
 *  (`LeagueGameMark`) and its lead scrim night's seats (`Seats`, the day green once full or dashed
 *  amber when its maybes could fill it — the scrims calendar's language), so scrims and season matches
 *  read apart at a glance. A league match always takes precedence: on a day with one, its diamonds
 *  come first and the scrim night's seats are muted, without the day's green or amber. Today is
 *  outlined. Renders only in the browser, since its days depend on the viewer's
 *  timezone; each day's label carries what it holds. */
export function UpcomingWeekStrip(props: Props) {
  const mounted = useHasMounted();
  if (!mounted) return <SkeletonBar className="h-[78px] w-full" />;
  return <Strip {...props} />;
}

function Strip({ gameTimes, scrims }: Props) {
  // The week starts on the viewer's today, read once when the strip mounts.
  const [days] = useState(() => {
    const now = new Date();
    return Array.from({ length: DAYS }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + i));
  });
  const gamesOn = new Map<string, number>();
  for (const t of gameTimes) {
    const key = localDayKey(new Date(t));
    gamesOn.set(key, (gamesOn.get(key) ?? 0) + 1);
  }
  const scrimsOn = new Map<string, UpcomingScrimNight[]>();
  for (const s of scrims) {
    const key = localDayKey(new Date(s.night.startsAt));
    scrimsOn.set(key, [...(scrimsOn.get(key) ?? []), s]);
  }

  return (
    <div className="grid grid-cols-7 gap-1 px-5 py-3 border-b border-[var(--color-border-tertiary)]">
      {days.map((date, i) => {
        const key = localDayKey(date);
        const games = gamesOn.get(key) ?? 0;
        const { lead, fill } = dayNightFill(scrimsOn.get(key) ?? []);
        // A league game owns its day: the scrim night stays visible but doesn't colour the day.
        const dayFill = games > 0 ? 'short' : fill;
        const label = [
          date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
          games > 0 && `${games} league ${games === 1 ? 'game' : 'games'}`,
          lead && `scrim night: ${lead.definite} definite, ${lead.maybe} maybe${fill === 'full' ? ', full' : ''}`,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <div
            key={key}
            role="img"
            aria-label={label}
            title={label}
            className={`flex flex-col items-center justify-start gap-0.5 min-h-[64px] pt-1 pb-1.5 border ${DAY_FILL_CLS[dayFill]} ${
              i === 0 ? 'outline outline-2 -outline-offset-2 outline-[var(--color-site-accent)]' : ''
            }`}
          >
            <span className="tracked text-[9px] text-[var(--color-text-secondary)]">{date.toLocaleDateString('en-US', { weekday: 'short' })}</span>
            <span className="font-mono text-[12px]">{date.getDate()}</span>
            {games > 0 && <GameDiamonds count={games} />}
            {lead && (
              <span className={games > 0 ? 'opacity-40' : undefined}>
                <Seats definite={lead.definite} maybe={lead.maybe} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A diamond per league game that day, up to `MAX_DIAMONDS` with the rest as `+N`. */
function GameDiamonds({ count }: { count: number }) {
  return (
    <span aria-hidden className="flex items-center gap-0.5 mt-0.5">
      {Array.from({ length: Math.min(count, MAX_DIAMONDS) }, (_, i) => (
        <LeagueGameMark key={i} />
      ))}
      {count > MAX_DIAMONDS && <span className="font-mono text-[9px] leading-none text-[var(--color-text-secondary)]">+{count - MAX_DIAMONDS}</span>}
    </span>
  );
}
