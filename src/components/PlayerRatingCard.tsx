// FIFA-style player card: a header row (avatar, name, best-fit playstyle line, big OVR) over the
// site's standard bordered-rectangle panel — matching the shape and theming of every other card
// on the site (StatTileGrid, MatchCard, …) rather than a standalone shape of its own — plus the
// six sub-attributes paired into FIFA's two-column layout (first three left, last three right,
// divided by a vertical rule per row) instead of a plain tile grid. Sub-stat values/colors arrive
// pre-computed (the caller already builds this exact StatTile shape for the Plus Stats tile grid)
// — this component is presentational only, it does no rating math itself. See
// docs/calculations.md "Player Rating" / "Role ratings" for how the caller derives these numbers.

import PlayerAvatar from './PlayerAvatar';
import type { StatTile } from './StatTileGrid';
import { plusStyle } from '@/lib/util';

export interface RoleRatingLine {
  label: string;
  /** 0-100, already run through toRatingScale(). */
  rating: number;
  /** Whichever role rating sits furthest above league average — at most one line is ever true. */
  isBestFit: boolean;
}

/** OVR color via the shared plusStyle(), converting the 0-100 display value back to the
 *  underlying 1.00-centered ratio it was rescaled from. */
function ratingStyle(rating: number): React.CSSProperties {
  return plusStyle(rating / 50);
}

function StatRow({ left, right, first }: { left?: StatTile; right?: StatTile; first: boolean }) {
  return (
    <div className={`grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 py-2 ${first ? '' : 'border-t border-[var(--color-border-tertiary)]'}`}>
      <div className="flex items-baseline justify-end gap-1.5" title={left?.title}>
        <span className="font-display text-[15px] font-bold leading-none tnum" style={left?.valueStyle}>{left?.value}</span>
        <span className="tracked text-[9px] text-[var(--color-text-secondary)]">{left?.label.replace('+', '')}</span>
      </div>
      <div className="h-full w-px bg-[var(--color-border-tertiary)]" />
      <div className="flex items-baseline gap-1.5" title={right?.title}>
        <span className="font-display text-[15px] font-bold leading-none tnum" style={right?.valueStyle}>{right?.value}</span>
        <span className="tracked text-[9px] text-[var(--color-text-secondary)]">{right?.label.replace('+', '')}</span>
      </div>
    </div>
  );
}

export default function PlayerRatingCard({
  name,
  avatarUrl,
  rating,
  subStats,
  roles,
}: {
  name: string;
  avatarUrl?: string | null;
  /** Player Rating, 0-100 (50 = league average). */
  rating: number;
  /** Already-shaped Plus-stat tiles (same StatTile objects the Plus Stats grid renders) — value
   *  0-100 with valueStyle set via plusStyle(). Exactly 6, split into a left column (first 3) and
   *  right column (last 3), the same pairing convention FIFA cards use. */
  subStats: StatTile[];
  /** Entry/Anchor/Setup Role Ratings — always three lines; the best-fit one (furthest above
   *  league average) is highlighted, the rest render plain. */
  roles: RoleRatingLine[];
}) {
  const leftStats = subStats.slice(0, 3);
  const rightStats = subStats.slice(3, 6);

  return (
    <div className="lift-card border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] p-5 max-w-sm">
      <div className="flex items-center gap-4 mb-4">
        <PlayerAvatar name={name} imageUrl={avatarUrl} size="lg" round />
        <div className="flex-1 min-w-0">
          <div className="font-display text-lg font-semibold truncate">{name}</div>
          <div className="mt-1 space-y-0.5">
            {roles.map((r) => (
              <div
                key={r.label}
                className={`tracked text-[10px] ${r.isBestFit ? 'font-semibold' : ''}`}
                style={{ color: r.isBestFit ? 'var(--color-site-accent)' : 'var(--color-text-secondary)' }}
                title={r.isBestFit ? `${r.label} — best-fit role, furthest above league average` : r.label}
              >
                {r.label} · {r.rating}
              </div>
            ))}
          </div>
        </div>
        <div
          className="text-right shrink-0"
          title="50 = this league's average, not a global skill percentile. Omits Beer Tax (not yet computed)."
        >
          <div className="tracked text-[9px] text-[var(--color-text-secondary)]">OVR</div>
          <div className="font-display text-[40px] font-bold leading-none tnum" style={ratingStyle(rating)}>
            {rating}
          </div>
        </div>
      </div>

      <div className="border border-[var(--color-border-primary)]">
        {[0, 1, 2].map((i) => (
          <StatRow key={i} left={leftStats[i]} right={rightStats[i]} first={i === 0} />
        ))}
      </div>
    </div>
  );
}
