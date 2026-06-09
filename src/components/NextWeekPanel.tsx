import Link from 'next/link';
import { YouBadge } from './YouBadge';
import { weekWindow, fmtWindowDate } from '@/lib/util';
import type { WeekWithMatches, MatchWithRoster } from '@/lib/queries';
import type { Season } from '@/lib/types';

function MatchupRow({
  match,
  currentPlayerId,
}: {
  match: MatchWithRoster;
  currentPlayerId: number | null;
}) {
  const isInMatch = currentPlayerId !== null && (
    match.shirts.some((p) => p.player_id === currentPlayerId) ||
    match.skins.some((p) => p.player_id === currentPlayerId)
  );
  const shirts = match.shirts.map((p) => p.player_name).join(' & ') || 'TBD';
  const skins = match.skins.map((p) => p.player_name).join(' & ') || 'TBD';

  return (
    <Link
      href={`/matches/${match.id}`}
      className="lift-row flex items-center gap-3 px-5 py-2.5 border-b border-[var(--color-border-tertiary)] last:border-b-0"
    >
      <span className="tracked text-[9px] text-[var(--color-text-secondary)] shrink-0 w-12">
        Match {match.match_number}
      </span>
      {isInMatch && <YouBadge />}
      <span className="font-display text-[13px] font-semibold truncate min-w-0">{shirts}</span>
      <span className="tracked text-[9px] text-[var(--color-text-secondary)] shrink-0">vs</span>
      <span className="font-display text-[13px] font-semibold truncate min-w-0">{skins}</span>
    </Link>
  );
}

export function NextWeekPanel({
  season,
  week,
  currentPlayerId,
}: {
  season: Season;
  week: WeekWithMatches;
  currentPlayerId: number | null;
}) {
  const win = weekWindow(season.start_date, week.week_number);
  const matches = [...week.matches].sort((a, b) => a.match_number - b.match_number);

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <div className="px-5 py-2.5 border-b border-[var(--color-border-tertiary)] flex items-baseline gap-3">
        <span className="tracked text-[10px] font-semibold text-[var(--color-text-secondary)]">
          Next Week
        </span>
        {win && (
          <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">
            {fmtWindowDate(win.start)} – {fmtWindowDate(win.end)}
          </span>
        )}
      </div>
      {matches.map((m) => (
        <MatchupRow key={m.id} match={m} currentPlayerId={currentPlayerId} />
      ))}
    </div>
  );
}
