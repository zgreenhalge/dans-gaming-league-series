'use client';

import { useState, useMemo } from 'react';
import { MatchCard, type MatchCardRight } from './MatchCard';
import { YouBadge } from './YouBadge';
import { isPlayedScore, fmtWindowDate } from '@/lib/util';
import type { WeekWithMatches } from '@/lib/queries';

function weekWindow(
  startDate: string | null,
  weekNumber: number,
): { start: Date; end: Date } | null {
  if (!startDate) return null;
  const [y, m, d] = startDate.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  return {
    start: new Date(base + (weekNumber - 1) * 7 * 86_400_000),
    end: new Date(base + ((weekNumber - 1) * 7 + 6) * 86_400_000),
  };
}

function WeekBlock({
  week,
  seasonStartDate,
  currentPlayerId,
  isOpen,
  onToggle,
}: {
  week: WeekWithMatches;
  seasonStartDate: string | null;
  currentPlayerId: number | null;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const win = weekWindow(seasonStartDate, week.week_number);
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] mb-4 last:mb-0">
      <button
        onClick={onToggle}
        className="w-full px-4 py-2.5 flex items-center gap-3 border-b border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors text-left"
        aria-expanded={isOpen}
      >
        <span className="text-[var(--color-text-secondary)] text-[12px] leading-none select-none w-3 shrink-0">
          {isOpen ? '−' : '+'}
        </span>
        <div className="flex items-baseline gap-2.5 flex-1 min-w-0">
          <span className="tracked text-[11px] font-semibold text-[var(--color-text-primary)]">
            Week {week.week_number}
          </span>
          {win && (
            <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">
              {fmtWindowDate(win.start)} – {fmtWindowDate(win.end)}
            </span>
          )}
        </div>
        {week.bye_player_name && (
          <span className="font-mono text-[10px] text-[var(--color-text-secondary)] inline-flex items-center gap-1 shrink-0">
            <span className="tracked mr-0.5">Bye</span>
            {week.bye_player_name}
            {currentPlayerId !== null && week.bye_player_id === currentPlayerId && <YouBadge />}
          </span>
        )}
      </button>
      {isOpen &&
        week.matches.map((m) => {
          const played = isPlayedScore(m.final_score);
          let right: MatchCardRight = null;
          if (played) {
            right = { type: 'score', score: m.final_score! };
          } else if (m.scheduled_at) {
            right = { type: 'scheduled', scheduledAt: m.scheduled_at };
          } else if (win) {
            right = { type: 'week-window', weekStart: win.start, weekEnd: win.end };
          }
          return (
            <MatchCard
              key={m.id}
              href={`/matches/${m.id}`}
              map={m.shirts_pick ?? m.picked_map}
              label={{ type: 'match', matchNumber: m.match_number }}
              right={right}
              shirtsStats={m.shirts_stats}
              skinsStats={m.skins_stats}
              shirtsFallback={m.shirts.map((p) => p.player_name).join(' & ') || 'Shirts TBD'}
              skinsFallback={m.skins.map((p) => p.player_name).join(' & ') || 'Skins TBD'}
              currentPlayerId={currentPlayerId}
            />
          );
        })}
    </div>
  );
}

export default function ScheduleList({
  schedule,
  seasonStartDate,
  currentPlayerId,
}: {
  schedule: WeekWithMatches[];
  seasonStartDate: string | null;
  currentPlayerId: number | null;
}) {
  const defaultOpenSet = useMemo(() => {
    const firstIncompleteIdx = schedule.findIndex((w) =>
      w.matches.some((m) => !isPlayedScore(m.final_score)),
    );
    if (firstIncompleteIdx !== -1) {
      return new Set([schedule[firstIncompleteIdx].id]);
    }
    // All complete: open the last week
    if (schedule.length > 0) {
      return new Set([schedule[schedule.length - 1].id]);
    }
    return new Set<number>();
  }, [schedule]);

  const [openWeeks, setOpenWeeks] = useState<Set<number>>(defaultOpenSet);

  const allOpen = openWeeks.size === schedule.length;

  function toggleWeek(id: number) {
    setOpenWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allOpen) {
      setOpenWeeks(new Set());
    } else {
      setOpenWeeks(new Set(schedule.map((w) => w.id)));
    }
  }

  if (schedule.length === 0) {
    return (
      <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
        No weeks scheduled.
      </div>
    );
  }

  return (
    <div>
      {schedule.length > 1 && (
        <div className="flex justify-end mb-3">
          <button
            onClick={toggleAll}
            className="tracked text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      )}
      {schedule.map((w) => (
        <WeekBlock
          key={w.id}
          week={w}
          seasonStartDate={seasonStartDate}
          currentPlayerId={currentPlayerId}
          isOpen={openWeeks.has(w.id)}
          onToggle={() => toggleWeek(w.id)}
        />
      ))}
    </div>
  );
}
