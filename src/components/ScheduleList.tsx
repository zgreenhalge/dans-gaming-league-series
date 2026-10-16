'use client';

import EmptyState from './EmptyState';
import { CollapsibleSection } from './CollapsibleSection';
import { MatchCard, matchCardRight } from './MatchCard';
import { PlayerName } from './PlayerName';
import { fmtWindowDate, weekLabel, weekWindow, weekAnchorId } from '@/lib/util';
import { weekHref } from '@/lib/crumbs';
import type { MatchWithRoster, WeekWithMatches } from '@/lib/queries';
import { effectivePickedMap } from '@/lib/veto';


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
      map={effectivePickedMap(m)}
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
    <CollapsibleSection
      id={weekAnchorId(week.id)}
      title={weekLabel(week.week_number, false)}
      detail={win ? `${fmtWindowDate(win.start)} – ${fmtWindowDate(win.end)}` : undefined}
      trailing={
        week.bye_player_name && (
          <span className="font-mono text-[10px] text-[var(--color-text-secondary)] inline-flex items-center gap-1 shrink-0">
            <span className="tracked mr-0.5">Bye</span>
            <PlayerName name={week.bye_player_name} isMe={currentPlayerId !== null && week.bye_player_id === currentPlayerId} />
          </span>
        )
      }
      href={hubSeasonId != null ? weekHref(hubSeasonId, week.id) : undefined}
      open={isOpen}
      onToggle={onToggle}
    >
      {week.matches.map((m) => (
        <WeekMatchCard key={m.id} match={m} win={win} currentPlayerId={currentPlayerId} />
      ))}
    </CollapsibleSection>
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
