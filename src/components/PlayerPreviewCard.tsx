import type { PlayerSummary } from '@/lib/queries';
import { PlayerSummaryBlock, PlayerSummaryBlockSkeleton } from './PlayerSummaryBlock';

/** The card's width; `PlayerLink` measures the rendered card rather than reading this. */
const PLAYER_PREVIEW_CARD_WIDTH_REM = 20;

/** The player hover card's body: a player's `PlayerSummary` — EHOG, W-L, KDA, ADR and Form — or a
 *  pulsing skeleton of the same layout while `summary` is `null`. A floating panel: the home
 *  panels' site-accent top edge, an accent-tinted border and a shadow with a faint accent glow, so it
 *  stands out from the page behind it. */
export function PlayerPreviewCard({ summary }: { summary: PlayerSummary | null }) {
  return (
    <div
      className="max-w-[calc(100vw-1rem)] border bg-[var(--color-bg-secondary)] p-3 shadow-2xl"
      style={{
        width: `${PLAYER_PREVIEW_CARD_WIDTH_REM}rem`,
        borderColor: 'color-mix(in srgb, var(--color-site-accent) 55%, var(--color-border-primary))',
        borderTopColor: 'var(--color-site-accent)',
        borderTopWidth: '3px',
        // A dark halo plus a faint accent glow lifts the card off a page of similar colors.
        boxShadow: '0 12px 32px rgb(0 0 0 / 0.45), 0 0 0 1px rgb(0 0 0 / 0.25), 0 0 18px color-mix(in srgb, var(--color-site-accent) 25%, transparent)',
      }}
    >
      {summary ? (
        <PlayerSummaryBlock summary={summary} showForm compact />
      ) : (
        <PlayerSummaryBlockSkeleton compact />
      )}
    </div>
  );
}
