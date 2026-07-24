// FIFA-style player card: one big OVR (Player Rating), a handful of sub-attribute tiles, and a
// best-fit playstyle badge. All values arrive already on the 0-100 display scale (50 = league
// average) — this component is presentational only, it does no rating math itself. See
// docs/calculations.md "Player Rating" / "Role ratings" for how the caller derives these numbers.

import PlayerAvatar from './PlayerAvatar';

export interface RatingSubStat {
  label: string;
  /** 0-100, already run through toRatingScale(). */
  value: number;
  title?: string;
}

export interface RoleBadge {
  label: string;
  /** 0-100, already run through toRatingScale(). */
  rating: number;
}

/** Same color-mix formula as the Plus Stats table's plusStyle(), just re-centered on the 0-100
 *  scale (50 = neutral) instead of the underlying 1.00-centered ratio. */
function ratingStyle(rating: number): React.CSSProperties {
  const delta = Math.max(-1, Math.min(1, (rating - 50) / 50));
  const pct = Math.round(Math.abs(delta) * 100);
  if (pct === 0) return {};
  const accent = delta > 0 ? 'var(--color-accent-green-fg)' : 'var(--color-accent-red-fg)';
  return { color: `color-mix(in srgb, ${accent} ${pct}%, var(--color-text-primary))` };
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
  subStats: RatingSubStat[];
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

      <div className="border border-[var(--color-border-primary)]">
        <div className="grid grid-cols-3 gap-px bg-[var(--color-border-tertiary)]">
          {subStats.map((s) => (
            <div key={s.label} title={s.title} className="bg-[var(--color-bg-primary)] px-2 py-2.5 text-center">
              <div className="font-display text-lg font-semibold tnum leading-none" style={ratingStyle(s.value)}>
                {s.value}
              </div>
              <div className="tracked text-[8px] text-[var(--color-text-secondary)] mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 text-[10px] text-[var(--color-text-secondary)] leading-snug">
        50 = this league&apos;s average, not a global skill percentile. Omits Beer Tax (not yet computed).
      </div>
    </div>
  );
}
