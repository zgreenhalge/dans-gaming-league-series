// FIFA Ultimate Team-style player card: a shield/crest silhouette (not a plain rectangle) with
// the OVR pinned to the top-left corner, a large centered portrait, the player's name, best-fit
// playstyle line, and six sub-attributes arranged in the same two-column layout FIFA cards use
// (PAC/SHO/PAS left, DRI/DEF/PHY right). Sub-stat values/colors arrive pre-computed (the caller
// already builds this exact StatTile shape for the Plus Stats tile grid) — this component is
// presentational only, it does no rating math itself. See docs/calculations.md "Player Rating" /
// "Role ratings" for how the caller derives these numbers.

import PlayerAvatar from './PlayerAvatar';
import type { StatTile } from './StatTileGrid';

export interface RoleRatingLine {
  label: string;
  /** 0-100, already run through toRatingScale(). */
  rating: number;
  /** Whichever role rating sits furthest above league average — at most one line is ever true. */
  isBestFit: boolean;
}

/** A shield/crest outline (percentage-based `clip-path` points, so it scales to any rendered
 *  card width rather than one fixed pixel size) — a smoothed width-per-height profile sampled at
 *  22 points per side: wide across the top, a concave notch below the shoulders, a wide bulge
 *  through the chest, then a taper to a point at the bottom. */
const SHIELD_CLIP = 'polygon(83.5% 0%, 81.8% 4.5%, 76.9% 9.1%, 73.9% 13.6%, 74.5% 18.2%, 78.3% 22.7%, 88.2% 27.3%, 93.8% 31.8%, 100% 36.4%, 99.8% 40.9%, 99.5% 45.5%, 98.6% 50%, 96.7% 54.5%, 95.8% 59.1%, 92.8% 63.6%, 89.4% 68.2%, 87.4% 72.7%, 81.6% 77.3%, 78.6% 81.8%, 70.2% 86.4%, 64.2% 90.9%, 56.9% 95.5%, 50% 100%, 43.1% 95.5%, 35.8% 90.9%, 29.8% 86.4%, 21.4% 81.8%, 18.4% 77.3%, 12.6% 72.7%, 10.6% 68.2%, 7.2% 63.6%, 4.2% 59.1%, 3.3% 54.5%, 1.4% 50%, 0.5% 45.5%, 0.2% 40.9%, 0% 36.4%, 6.2% 31.8%, 11.8% 27.3%, 21.7% 22.7%, 25.5% 18.2%, 26.1% 13.6%, 23.1% 9.1%, 18.2% 4.5%, 16.5% 0%)';

/** The card face always renders dark (accent blended toward black, not toward the page's
 *  bg-secondary) so its white/translucent-white text stays legible in both the site's light and
 *  dark themes — a trading card is allowed its own committed look, the way a gold FIFA card reads
 *  the same regardless of the app chrome around it. The hue itself still comes from the
 *  theme-aware site accent (T-orange in light mode, CT-cyan in dark), so it isn't a hardcoded
 *  color — just a fixed light/dark commitment for this one surface. */
const CARD_FACE_GRADIENT = 'linear-gradient(160deg, color-mix(in srgb, var(--color-site-accent) 55%, black) 0%, color-mix(in srgb, var(--color-site-accent) 82%, black) 45%, color-mix(in srgb, var(--color-site-accent) 40%, black) 100%)';
const CARD_RIM_COLOR = 'color-mix(in srgb, var(--color-site-accent) 65%, white)';
const CARD_SHINE = 'linear-gradient(120deg, transparent 35%, rgba(255,255,255,0.45) 47%, transparent 60%)';

function StatRow({ left, right, first }: { left?: StatTile; right?: StatTile; first: boolean }) {
  return (
    <div
      className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-2"
      style={first ? undefined : { borderTop: '1px solid rgba(255,255,255,0.18)' }}
    >
      <div className="flex items-baseline justify-end gap-1.5" title={left?.title}>
        <span className="font-display text-[15px] font-bold leading-none tnum" style={left?.valueStyle}>{left?.value}</span>
        <span className="tracked text-[9px] text-white/70">{left?.label.replace('+', '')}</span>
      </div>
      <div className="h-full w-px bg-white/20" />
      <div className="flex items-baseline gap-1.5" title={right?.title}>
        <span className="font-display text-[15px] font-bold leading-none tnum" style={right?.valueStyle}>{right?.value}</span>
        <span className="tracked text-[9px] text-white/70">{right?.label.replace('+', '')}</span>
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
   *  league average) is highlighted, the rest render dimmed. */
  roles: RoleRatingLine[];
}) {
  const leftStats = subStats.slice(0, 3);
  const rightStats = subStats.slice(3, 6);

  return (
    <div className="mx-auto w-full max-w-[300px]">
      <div className="relative w-full" style={{ aspectRatio: '400 / 508', clipPath: SHIELD_CLIP, background: CARD_RIM_COLOR }}>
        <div className="absolute inset-[3px] isolate overflow-hidden" style={{ clipPath: SHIELD_CLIP, background: CARD_FACE_GRADIENT }}>
          <div className="absolute inset-0" style={{ background: CARD_SHINE, mixBlendMode: 'overlay' }} />

          <div
            className="absolute left-[9%] top-[5%] text-left"
            title="50 = this league's average, not a global skill percentile. Omits Beer Tax (not yet computed)."
          >
            <div className="font-display text-[42px] leading-none font-black tnum text-white">
              {rating}
            </div>
            <div className="tracked text-[9px] text-white/75">OVR</div>
          </div>

          <div className="relative flex h-full flex-col items-center px-[8%] pb-[15%] pt-[17%]">
            <div className="w-[36%] shrink-0 aspect-square rounded-full overflow-hidden ring-2 ring-white/40 mb-2">
              <PlayerAvatar name={name} imageUrl={avatarUrl} size="xl" round />
            </div>

            <div className="font-display text-[17px] font-bold leading-tight text-white text-center truncate max-w-full px-2">
              {name}
            </div>

            <div className="mt-1.5 flex flex-col items-center gap-0.5">
              {roles.map((r) => (
                <div
                  key={r.label}
                  className={`tracked text-[9px] ${r.isBestFit ? 'font-semibold text-white' : 'text-white/55'}`}
                  title={r.isBestFit ? `${r.label} — best-fit role, furthest above league average` : r.label}
                >
                  {r.label} · {r.rating}
                </div>
              ))}
            </div>

            <div className="mt-3 h-px w-[70%] bg-white/25" />

            <div className="mt-1 w-full max-w-[88%]">
              {[0, 1, 2].map((i) => (
                <StatRow key={i} left={leftStats[i]} right={rightStats[i]} first={i === 0} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
