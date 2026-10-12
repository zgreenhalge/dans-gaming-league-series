'use client';

import Link from 'next/link';
import EmptyState from './EmptyState';
import { MatchCard, matchCardRight } from './MatchCard';
import { PlayerName } from './PlayerName';
import { fmtWindowDate, weekWindow, weekAnchorId } from '@/lib/util';
import { weekHref } from '@/lib/crumbs';
import type { MatchWithRoster, WeekWithMatches } from '@/lib/queries';


/** One regular-season match as a schedule row — shared by the season hub's week list and the week
 *  page, so a match reads identically in both. */
export function WeekMatchCard({
  match: m,
  win,
  currentPlayerId,
}: {
  match: MatchWithRoster;
  win: { start: Date; end: Date } | null;
  currentPlayerId: number | null;
}) {
  const right = matchCardRight(m.final_score, m.scheduled_at, win ? { type: 'week-window', weekStart: win.start, weekEnd: win.end } : null);
  return (
    <MatchCard
      href={`/matches/${m.id}`}
      map={m.shirts_pick ?? m.picked_map}
      label={{ type: 'match', matchNumber: m.match_number, isFeatureMatch: m.is_feature_match }}
      right={right}
      shirtsStats={m.shirts_stats}
      skinsStats={m.skins_stats}
      shirtsFallback={m.shirts.map((p) => p.player_name).join(' & ') || 'Shirts TBD'}
      skinsFallback={m.skins.map((p) => p.player_name).join(' & ') || 'Skins TBD'}
      currentPlayerId={currentPlayerId}
    />
  );
}

function WeekBlock({
  week,
  hubSeasonId,
  seasonStartDate,
  currentPlayerId,
  isOpen,
  onToggle,
}: {
  week: WeekWithMatches;
  hubSeasonId: number | null;
  seasonStartDate: string | null;
  currentPlayerId: number | null;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const win = weekWindow(seasonStartDate, week.week_number);
  return (
    <div id={weekAnchorId(week.id)} className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] mb-4 last:mb-0">
      <div className="relative">
      <button
        onClick={onToggle}
        className={`lift-row w-full px-4 py-2.5 ${hubSeasonId != null ? 'pr-20' : ''} flex items-center gap-3 border-b border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-left`}
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
            <PlayerName name={week.bye_player_name} isMe={currentPlayerId !== null && week.bye_player_id === currentPlayerId} />
          </span>
        )}
      </button>
        {hubSeasonId != null && (
          <Link
            href={weekHref(hubSeasonId, week.id)}
            className="absolute right-3 top-1/2 -translate-y-1/2 tracked text-[10px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            Open →
          </Link>
        )}
      </div>
      {isOpen &&
        week.matches.map((m) => (
          <WeekMatchCard key={m.id} match={m} win={win} currentPlayerId={currentPlayerId} />
        ))}
    </div>
  );
}

export default function ScheduleList({
  displaySchedule,
  openWeeks,
  onToggleWeek,
  seasonStartDate,
  hubSeasonId,
  currentPlayerId,
}: {
  displaySchedule: WeekWithMatches[];
  openWeeks: Set<number>;
  onToggleWeek: (id: number) => void;
  seasonStartDate: string | null;
  /** The season hub's id, for each week's page link; omit to render without links. */
  hubSeasonId?: number;
  currentPlayerId: number | null;
}) {
  if (displaySchedule.length === 0) {
    return <EmptyState message="No matches found." />;
  }

  return (
    <div>
      {displaySchedule.map((w) => (
        <WeekBlock
          key={w.id}
          week={w}
          hubSeasonId={hubSeasonId ?? null}
          seasonStartDate={seasonStartDate}
          currentPlayerId={currentPlayerId}
          isOpen={openWeeks.has(w.id)}
          onToggle={() => onToggleWeek(w.id)}
        />
      ))}
    </div>
  );
}
