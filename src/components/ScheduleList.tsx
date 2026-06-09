'use client';

import { MatchCard, type MatchCardRight } from './MatchCard';
import { YouBadge } from './YouBadge';
import { isPlayedScore, fmtWindowDate, weekWindow } from '@/lib/util';
import type { WeekWithMatches, MatchWithRoster } from '@/lib/queries';


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
        className="lift-row w-full px-4 py-2.5 flex items-center gap-3 border-b border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-left"
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
  displaySchedule,
  openWeeks,
  onToggleWeek,
  seasonStartDate,
  currentPlayerId,
}: {
  displaySchedule: WeekWithMatches[];
  openWeeks: Set<number>;
  onToggleWeek: (id: number) => void;
  seasonStartDate: string | null;
  currentPlayerId: number | null;
}) {
  if (displaySchedule.length === 0) {
    return (
      <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
        No matches found.
      </div>
    );
  }

  return (
    <div>
      {displaySchedule.map((w) => (
        <WeekBlock
          key={w.id}
          week={w}
          seasonStartDate={seasonStartDate}
          currentPlayerId={currentPlayerId}
          isOpen={openWeeks.has(w.id)}
          onToggle={() => onToggleWeek(w.id)}
        />
      ))}
    </div>
  );
}
