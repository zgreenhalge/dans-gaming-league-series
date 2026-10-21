import type { PlayerSummary } from '@/lib/queries';
import { PlayerSummaryBlock } from './PlayerSummaryBlock';

/** The player hover card's body: a player's `PlayerSummary` — EHOG, W-L, KDA, ADR and Form — in a
 *  floating bordered panel with the site-accent top edge the home panels use. */
export function PlayerPreviewCard({ summary }: { summary: PlayerSummary }) {
  return (
    <div
      className="w-[22rem] max-w-[calc(100vw-1rem)] border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] p-4 shadow-lg"
      style={{ borderTopColor: 'var(--color-site-accent)', borderTopWidth: '3px' }}
    >
      <PlayerSummaryBlock summary={summary} showForm />
    </div>
  );
}
