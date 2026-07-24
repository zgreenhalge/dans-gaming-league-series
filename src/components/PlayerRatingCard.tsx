// FIFA-style player card: one big OVR (Player Rating), a handful of sub-attribute tiles, and a
// best-fit playstyle badge. Sub-stat values/colors arrive pre-computed (the caller already builds
// this exact StatTile shape for the Plus Stats tile grid) — this component is presentational
// only, it does no rating math itself. See docs/calculations.md "Player Rating" / "Role ratings"
// for how the caller derives these numbers.

import PlayerAvatar from './PlayerAvatar';
import StatTileGrid, { type StatTile } from './StatTileGrid';
import { plusStyle } from '@/lib/util';

export interface RoleBadge {
  label: string;
  /** 0-100, already run through toRatingScale(). */
  rating: number;
}

/** OVR color via the shared plusStyle(), converting the 0-100 display value back to the
 *  underlying 1.00-centered ratio it was rescaled from. */
function ratingStyle(rating: number): React.CSSProperties {
  return plusStyle(rating / 50);
}

export default function PlayerRatingCard({
  name,
  avatarUrl,
  rating,
  subStats,
  role,
}: {
  name: string;
  avatarUrl?: string | null;
  /** Player Rating, 0-100 (50 = league average). */
  rating: number;
  /** Already-shaped Plus-stat tiles (same StatTile objects the Plus Stats grid renders) — value
   *  0-100 with valueStyle set via plusStyle(). */
  subStats: StatTile[];
  /** Best-fit playstyle (whichever Role Rating sits furthest above league average), or null if
   *  none clears average. */
  role?: RoleBadge | null;
}) {
  return (
    <div className="lift-card border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] p-5 max-w-sm">
      <div className="flex items-center gap-4 mb-4">
        <PlayerAvatar name={name} imageUrl={avatarUrl} size="lg" round />
        <div className="flex-1 min-w-0">
          <div className="font-display text-lg font-semibold truncate">{name}</div>
          {role && (
            <div
              className="tracked text-[10px] font-semibold mt-0.5"
              style={{ color: 'var(--color-site-accent)' }}
              title={`${role.label} — best-fit role rating ${role.rating}, furthest above league average`}
            >
              {role.label} · {role.rating}
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="tracked text-[9px] text-[var(--color-text-secondary)]">OVR</div>
          <div className="font-display text-[40px] font-bold leading-none tnum" style={ratingStyle(rating)}>
            {rating}
          </div>
        </div>
      </div>

      <StatTileGrid columns="grid-cols-3" variant="value-label" tiles={subStats} />

      <div className="mt-3 text-[10px] text-[var(--color-text-secondary)] leading-snug">
        50 = this league&apos;s average, not a global skill percentile. Omits Beer Tax (not yet computed).
      </div>
    </div>
  );
}
