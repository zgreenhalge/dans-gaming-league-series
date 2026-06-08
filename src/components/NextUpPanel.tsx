import Link from 'next/link';
import { LocalTime } from './LocalTime';
import { YouBadge } from './YouBadge';
import { toSentenceCase, mapImageFor } from '@/lib/maps';
import { isPlayedScore, parseScore, weekWindow, fmtWindowDate } from '@/lib/util';
import { CountdownTimer } from './CountdownTimer';
import type { WeekWithMatches, MatchWithRoster } from '@/lib/queries';
import type { Season } from '@/lib/types';

function TeamNames({ players }: { players: { player_id: number; player_name: string }[] }) {
  if (players.length === 0) return <span className="opacity-50">TBD</span>;
  return (
    <>
      {players.map((p, i) => (
        <span key={p.player_id} className="inline-flex items-center gap-0.5">
          {i > 0 && <span className="opacity-50 mx-0.5">&amp;</span>}
          {p.player_name}
        </span>
      ))}
    </>
  );
}

function MatchCell({
  match,
  currentPlayerId,
}: {
  match: MatchWithRoster;
  currentPlayerId: number | null;
}) {
  const map = match.shirts_pick ?? match.picked_map;
  const mapImg = mapImageFor(map);
  const isInMatch = currentPlayerId !== null && (
    match.shirts.some((p) => p.player_id === currentPlayerId) ||
    match.skins.some((p) => p.player_id === currentPlayerId)
  );
  const played = isPlayedScore(match.final_score);
  const score = played ? parseScore(match.final_score) : null;

  return (
    <Link
      href={`/matches/${match.id}`}
      className={`block border-r border-[var(--color-border-tertiary)] last:border-r-0 transition-colors ${mapImg ? 'map-card-bg' : 'lift-row'}`}
      style={mapImg ? { ['--map-img' as string]: `url("${mapImg}")` } : undefined}
    >
      <div className={mapImg ? 'bg-[var(--overlay-strong)] hover:bg-[var(--overlay-medium)] transition-colors' : ''}>
        <div className="px-5 pt-4 pb-2 flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <span className="tracked text-[11px] font-semibold text-[var(--color-text-primary)] map-head">
              Match {match.match_number}
            </span>
            {map && (
              <span className="tracked text-[9px] text-[var(--color-text-secondary)] map-head">
                · {toSentenceCase(map)}
              </span>
            )}
          </div>
          {isInMatch && <YouBadge />}
        </div>

        <div className="px-5 pb-4 flex items-center justify-between gap-4">
          <div className="shrink-0 flex items-center">
            {score ? (
              <div className="font-display font-semibold leading-none">
                <div className="text-[22px] text-[var(--color-text-primary)] map-head">{score.shirts}</div>
                <div className="text-[10px] text-[var(--color-text-secondary)] my-0.5 map-head">–</div>
                <div className="text-[22px] text-[var(--color-text-primary)] map-head">{score.skins}</div>
              </div>
            ) : match.scheduled_at ? (
              <div>
                <div className="font-mono text-[11px] map-head" style={{ color: 'var(--color-site-accent)' }}>
                  <LocalTime iso={match.scheduled_at} opts={{ weekday: 'short', hour: 'numeric', minute: '2-digit' }} />
                </div>
                <CountdownTimer iso={match.scheduled_at} className="tracked text-[9px] text-[var(--color-text-secondary)] mt-0.5 map-head" />
              </div>
            ) : (
              <span className="tracked text-[11px] text-[var(--color-text-secondary)] opacity-60">
                Pending
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1 text-right">
            <div className="font-display text-[14px] font-semibold leading-tight truncate map-head">
              <TeamNames players={match.shirts} />
            </div>
            <div className="tracked text-[9px] text-[var(--color-text-secondary)] my-1 map-head">vs</div>
            <div className="font-display text-[14px] font-semibold leading-tight truncate map-head">
              <TeamNames players={match.skins} />
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

export function NextUpPanel({
  season,
  week,
  matches,
  currentPlayerId,
}: {
  season: Season;
  week: WeekWithMatches;
  matches: MatchWithRoster[];
  currentPlayerId: number | null;
}) {
  const win = weekWindow(season.start_date, week.week_number);
  const colCount = Math.min(matches.length, 4);
  const colsCls =
    colCount === 1 ? 'grid-cols-1' :
    colCount === 2 ? 'grid-cols-2' :
    colCount === 3 ? 'grid-cols-3' :
    'grid-cols-4';

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <div className="px-6 py-4 border-b border-[var(--color-border-tertiary)] flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-[18px] font-semibold text-[var(--color-text-primary)]">
            This Week
          </span>
          {win && (
            <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">
              {fmtWindowDate(win.start)} – {fmtWindowDate(win.end)}
            </span>
          )}
        </div>
      </div>

      <div className={`grid ${colsCls}`}>
        {matches.map((m) => (
          <MatchCell key={m.id} match={m} currentPlayerId={currentPlayerId} />
        ))}
      </div>
    </div>
  );
}
