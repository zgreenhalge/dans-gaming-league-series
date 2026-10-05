// Public tallies for a season's superlatives, shown on the season page once voting has closed. The
// top nominee (all of them, on a tie) leads each superlative; the rest follow with their vote counts.
// Voters are never shown — `SuperlativeResults` carries only per-nominee counts.

import Link from 'next/link';
import type { SuperlativeResults } from '@/lib/queries';

export function SuperlativeResultsPanel({ results }: { results: SuperlativeResults }) {
  const withVotes = results.superlatives.filter((s) => s.totalVotes > 0);
  return (
    <div className="flex flex-col gap-6">
      <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">
        {results.voterCount} {results.voterCount === 1 ? 'player' : 'players'} voted
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {withVotes.map((s) => {
          const top = s.nominees[0].votes;
          return (
            <div key={s.id} className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] p-4 flex flex-col gap-3">
              <div className="tracked text-[10px] text-[var(--color-text-secondary)]">{s.title}</div>
              <ol className="flex flex-col gap-1.5">
                {s.nominees.map((n) => (
                  <li key={n.player_id} className={`flex items-baseline justify-between gap-3 ${n.votes === top ? '' : 'text-[var(--color-text-secondary)]'}`}>
                    <Link
                      href={`/players/${n.player_id}`}
                      className={`hover:underline truncate ${n.votes === top ? 'font-display text-[18px] font-semibold' : 'font-mono text-[12px]'}`}
                    >
                      {n.player_name}
                    </Link>
                    <span className="font-mono text-[11px] shrink-0">
                      {n.votes} {n.votes === 1 ? 'vote' : 'votes'}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </div>
  );
}
