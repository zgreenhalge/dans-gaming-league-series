import Link from 'next/link';
import { CountdownTimer } from './CountdownTimer';

/** A player's next match as one line — "Next Match", the map, the opponents and a countdown to the
 *  scheduled time — linking to the match. Shared by the player page and the home page's My Stats. */
export function NextMatchLink({
  matchId,
  map,
  opponents,
  scheduledAt,
  className = '',
}: {
  matchId: number;
  map: string | null;
  opponents: string;
  scheduledAt: string | null;
  className?: string;
}) {
  return (
    <Link
      href={`/matches/${matchId}`}
      className={`inline-flex items-center gap-3 hover:opacity-80 transition-opacity ${className}`}
    >
      <span className="tracked text-[10px] text-[var(--color-text-secondary)] shrink-0">Next Match</span>
      <div className="flex items-center gap-2 font-mono text-[12px] min-w-0">
        {map && <span className="font-semibold text-[var(--color-text-primary)] truncate">{map}</span>}
        <span className="text-[var(--color-text-secondary)] shrink-0">vs</span>
        <span className="text-[var(--color-text-primary)] truncate">{opponents}</span>
        {scheduledAt && (
          <CountdownTimer iso={scheduledAt} className="tracked text-[9px] text-[var(--color-text-secondary)]" />
        )}
      </div>
    </Link>
  );
}
