import type { ReactElement, SVGProps } from 'react';
import type { RoundCondition, RoundHistoryEntry } from '@/lib/types';

type Side = 'CT' | 'T';

/**
 * CS2-scoreboard-style round-history strip.
 *
 * Each round tile encodes three independent things:
 *   - vertical track  = winning TEAM  (Shirts on top, Skins on bottom)
 *   - color           = winning SIDE  (T=orange, CT=blue — CS2 muscle memory)
 *   - icon            = win CONDITION (elim / bomb / defuse / time)
 *
 * Dividers mark every side-swap / phase boundary (halftime, then each overtime
 * half) and carry a running score callout, scaling to any number of overtimes.
 */

/**
 * Round-result icons, extracted from CS2's own Panorama UI assets (via
 * https://github.com/Juknum/counter-strike-icons) rather than a generic icon set — this keeps the
 * defuse icon (wire cutters) unambiguous instead of looking like a pair of scissors. Each path's
 * fill is `currentColor` so `RoundTile` can tint it in the winning team's color.
 */
type ConditionIconProps = SVGProps<SVGSVGElement> & { size: number };

function SkullIcon({ size, ...props }: ConditionIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="currentColor"
        d="M28.443 16.724C28.463 14.991 27.853 14.952 27.814 13.889C27.793 13.357 27.858 11.864 27.814 10.425C27.769 8.991 27.616 7.608 27.499 7.275C27.263 6.606 26.995 5.502 24.979 3.81C22.773 1.959 18.52 0.383996 16.159 0.344996C13.796 0.304996 11.04 1.487 8.91301 2.865C6.78701 4.243 6.27501 4.834 5.44901 6.015C4.62101 7.196 4.30601 8.023 4.50301 10.11C4.70001 12.197 4.74701 11.647 4.81801 13.575C4.87801 15.17 4.15301 15.663 4.18801 16.725C4.24001 18.312 4.83601 18.641 4.81801 19.245C4.80501 19.641 4.10901 20.138 4.18801 21.45C4.26801 22.786 4.54201 23.143 7.02301 24.6C8.63301 25.545 10.527 25.899 10.488 26.49C10.43 27.355 10.213 28.774 10.174 29.64C10.135 30.506 10.528 30.585 11.433 30.9C12.34 31.215 14.465 31.884 16.789 31.845C19.112 31.805 20.097 31.333 21.199 30.9C22.301 30.467 22.459 30.073 22.459 29.325C22.459 28.577 21.829 27.042 21.829 26.49C21.829 25.939 23.719 25.348 25.924 24.285C28.13 23.222 28.104 22.16 28.13 21.45C28.177 20.112 27.499 19.797 27.499 19.245C27.499 18.168 28.431 17.984 28.443 16.724ZM9.85801 19.874C8.75501 19.914 6.39301 19.914 6.39301 16.724C6.39301 12.305 8.75501 11.802 10.488 11.684C12.221 11.566 12.457 11.369 13.324 11.999C14.88 13.131 14.78 15.136 14.268 16.724C13.893 17.887 13.48 18.338 12.693 18.929C11.906 19.52 10.961 19.834 9.85801 19.874ZM17.104 24.914L16.67 23.306L16 23.313L15.528 24.915C13.716 24.423 12.988 23.695 13.008 22.71C13.028 21.726 13.579 20.702 14.582 19.875C15.587 19.048 15.749 18.92 16.473 18.93C17.164 18.94 17.225 19.074 17.733 19.56C18.83 20.611 19.54 21.311 19.624 22.71C19.706 24.086 18.107 24.855 17.104 24.914ZM22.773 19.874C21.67 19.834 20.726 19.52 19.938 18.929C19.151 18.338 18.686 17.902 18.363 16.724C17.956 15.241 17.753 13.131 19.309 11.999C20.175 11.369 20.411 11.566 22.144 11.684C23.875 11.802 26.239 12.305 26.239 16.724C26.239 19.914 23.876 19.914 22.773 19.874Z"
      />
    </svg>
  );
}

function BombIcon({ size, ...props }: ConditionIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        fill="currentColor"
        d="M31.656,20.297l-7.313-4.028l5.5-8.315l-9.125,2.656L20.063,0.516l-4.938,9.375L7.219,2.359l3.156,10.5l-10.031,0.25l8.188,6.406l-4.313,7.375l8.125-3.906l0.344,8.5l5.5-6.188l6.969,5.594l-1.625-8.594L31.656,20.297z M21.75,25.172l-3.563-3.281l-3.594,4.156l-0.531-5.969l-5,2.344l2.375-3.5l-5.5-3.813l7.125-0.219l-1.406-5.406l4.188,3.813l2.5-4.469l0.827,4.887l5.079-1.512l-3.281,5.031l4.518,2.373l-4.518,0.939L21.75,25.172z"
      />
      <polygon
        fill="currentColor"
        points="12.794,16.944 15.469,17.016 14.969,15.109 16.813,15.891 17.531,14.391 17.844,15.891 19.5,15.703 18.5,17.016 19.969,18.359 18.563,18.359 19.031,20.047 17.406,18.922 16.281,20.391 16.281,18.734 14.719,18.891 15.313,18.016"
      />
    </svg>
  );
}

function DefuseIcon({ size, ...props }: ConditionIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        fill="currentColor"
        d="M12.375 12.586L13.094 11.668C14.072 12.127 14.251 12.267 15.768 12.307C17.285 12.347 20.12 11.668 21.517 11.668C22.914 11.668 24.631 12.027 25.708 12.586C26.785 13.145 29.021 14.383 29.621 14.822C30.22 15.261 31.094 14.659 31.258 14.423C31.617 13.904 31.617 13.265 30.978 12.825C30.339 12.386 27.266 10.191 26.228 9.712C25.19 9.233 23.673 9.033 21.238 9.033C18.803 9.033 16.408 9.273 15.25 9.273C14.092 9.273 12.576 8.994 11.817 8.515L10.02 6.039L4.87 2.446C4.503 2.167 4.032 2.566 4.311 2.885C4.59 3.204 7.944 7.835 7.944 7.835L8.982 7.875V8.154L8.064 9.232H7.584L7.464 8.665C7.464 8.665 1.995 6.358 1.596 6.159C1.197 5.959 0.838 6.598 1.197 6.877C1.556 7.156 6.506 11.268 6.506 11.268L9.061 12.266C9.7 13.144 11.056 14.67 11.177 15.181C11.536 16.698 11.696 20.49 12.095 21.687C12.494 22.885 13.948 26.039 16.726 28.155C17.564 28.794 18.522 29.432 18.881 29.592C19.24 29.752 19.759 29.553 19.959 29.274C20.159 28.994 20.718 27.877 20.159 27.358C19.6 26.838 16.606 25.043 15.448 22.087C14.29 19.134 14.61 15.62 13.732 14.423C12.854 13.225 12.375 12.586 12.375 12.586Z"
      />
    </svg>
  );
}

function ClockIcon({ size, ...props }: ConditionIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <rect x="14.256" y="6.614" fill="currentColor" width="2.734" height="9.812" />
      <rect
        x="17.622"
        y="13.405"
        transform="matrix(0.6156 -0.7881 0.7881 0.6156 -7.1561 22.0159)"
        fill="currentColor"
        width="2.735"
        height="9.877"
      />
      <path
        fill="currentColor"
        d="M20.034,1.864c-2.605-0.742-5.242-0.707-7.684-0.057C12.34,1.81,12.33,1.813,12.318,1.815c-0.439,0.118-0.871,0.256-1.296,0.414c-0.032,0.012-0.065,0.02-0.099,0.032c-0.056,0.021-0.109,0.047-0.165,0.069c-0.252,0.1-0.504,0.201-0.75,0.315c-0.124,0.057-0.242,0.12-0.364,0.18C9.138,3.076,8.646,3.353,8.171,3.661C8.153,3.672,8.135,3.682,8.117,3.693C5.595,5.346,3.58,7.785,2.475,10.787c-0.529,1.364-0.88,2.816-1.02,4.322l0.143,0.001c-0.181,4.442,1.73,8.862,5.221,11.979l0.039-0.052c3.868,3.16,9.249,4.255,14.262,2.372c1.14-0.428,2.183-0.997,3.141-1.659c0.04-0.027,0.078-0.056,0.118-0.083c0.271-0.19,0.536-0.386,0.791-0.593c0.253-0.203,0.499-0.414,0.737-0.634c0.08-0.074,0.156-0.151,0.234-0.228c1.775-1.709,3.143-3.889,3.866-6.433C32.201,12.08,27.735,4.058,20.034,1.864z M25.475,22.374c-0.083,0.118-0.168,0.234-0.256,0.349c-0.158,0.212-0.316,0.423-0.489,0.624c-0.283,0.323-0.579,0.634-0.895,0.922c-0.063,0.06-0.134,0.113-0.199,0.171c-0.339,0.297-0.69,0.578-1.062,0.832c-0.015,0.011-0.029,0.021-0.045,0.031c-1.282,0.868-2.733,1.478-4.268,1.778l0.007,0.028c-3.587,0.716-7.227-0.347-9.87-2.69c-2.873-2.781-4.487-7.242-3.493-11.358c0.99-3.446,3.513-6.624,7.008-7.964c0.036-0.014,0.072-0.028,0.108-0.042c5.935-2.202,12.539,0.805,14.766,6.736C28.163,15.457,27.542,19.379,25.475,22.374z"
      />
    </svg>
  );
}

const CONDITION_ICON: Record<RoundCondition, (props: ConditionIconProps) => ReactElement> = {
  elim: SkullIcon,
  bomb: BombIcon,
  defuse: DefuseIcon,
  time: ClockIcon,
};

const CONDITION_LABEL: Record<RoundCondition, string> = {
  elim: 'elimination',
  bomb: 'bomb detonation',
  defuse: 'defuse',
  time: 'time expired',
};

/** CSS color for a side, matching the site-wide CT=blue / T=orange convention. */
function sideColor(side: Side): string {
  return side === 'T' ? 'var(--color-t)' : 'var(--color-ct)';
}

/**
 * Regulation half length is `targetWinRounds - 1` rounds; overtime halves are
 * 3 rounds each. Returns a segment index that increments at every half boundary.
 */
function segmentOf(n: number, regHalf: number): number {
  if (n <= regHalf) return 0;
  if (n <= 2 * regHalf) return 1;
  const otRound = n - 2 * regHalf;
  return 2 + Math.floor((otRound - 1) / 3);
}

/** Label + emphasis for the divider that *precedes* the given segment. */
function dividerLabel(newSeg: number): { label: string; major: boolean } {
  if (newSeg === 1) return { label: 'HALF', major: true };
  const otHalfIndex = newSeg - 2; // 0-based half within overtime
  const otNum = Math.floor(otHalfIndex / 2) + 1;
  // Even half index starts a new overtime; odd is that OT's mid-swap.
  if (otHalfIndex % 2 === 0) return { label: `OT${otNum}`, major: true };
  return { label: '', major: false };
}

type Column =
  | { type: 'round'; entry: RoundHistoryEntry; displayN: number }
  | { type: 'empty'; n: number }
  | { type: 'divider'; label: string; major: boolean; shirts: number; skins: number };

/**
 * `entry.n` is the raw parser round identity — it is NOT guaranteed to start at 1. When the demo
 * has a stray knife round, the engine counts it and never resets, so every real round's `n` is
 * shifted up by however many stray rounds preceded it (see `buildRoundSides()` in
 * `src/lib/parsers/roundSides.ts`, which anchors the half-swap boundary the same way). Segment and
 * regulation-length math here must use the round's position relative to the first surviving round,
 * not its raw `n`, or the half divider lands one round early exactly like the score bug did.
 */
function buildColumns(
  rounds: RoundHistoryEntry[],
  regHalf: number,
): Column[] {
  const cols: Column[] = [];
  const firstN = rounds.length > 0 ? rounds[0].n : 0;
  const realRound = (n: number) => n - firstN + 1;
  let shirts = 0;
  let skins = 0;
  for (let i = 0; i < rounds.length; i++) {
    const entry = rounds[i];
    cols.push({ type: 'round', entry, displayN: realRound(entry.n) });
    if (entry.winner === 'SHIRTS') shirts++;
    else skins++;

    const next = rounds[i + 1];
    if (next) {
      const segHere = segmentOf(realRound(entry.n), regHalf);
      const segNext = segmentOf(realRound(next.n), regHalf);
      if (segNext !== segHere) {
        const { label, major } = dividerLabel(segNext);
        cols.push({ type: 'divider', label, major, shirts, skins });
      }
    }
  }

  // If the game was clinched in regulation (no overtime), pad out the remaining
  // regulation rounds as greyed-out "unplayed" placeholders.
  const lastReal = rounds.length > 0 ? realRound(rounds[rounds.length - 1].n) : 0;
  const regMax = 2 * regHalf;
  if (lastReal < regMax) {
    for (let r = lastReal + 1; r <= regMax; r++) {
      cols.push({ type: 'empty', n: r });
    }
  }

  return cols;
}

function RoundTile({
  entry,
  displayN,
  color,
}: {
  entry: RoundHistoryEntry;
  displayN: number;
  color: string;
}) {
  const Icon = CONDITION_ICON[entry.condition];
  const onTop = entry.winner === 'SHIRTS';
  const teamName = entry.winner === 'SHIRTS' ? 'Shirts' : 'Skins';
  return (
    <div
      title={`Round ${displayN} — ${teamName} won (${CONDITION_LABEL[entry.condition]}), ${entry.side} side`}
      className="relative h-[26px] w-[26px] rounded-[3px] border flex items-center justify-center"
      style={{
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
      }}
    >
      <Icon size={15} style={{ color }} />
      {/* Accent bar on the edge facing the center spine */}
      <span
        className={`absolute inset-x-0 h-[2px] ${onTop ? 'bottom-0' : 'top-0'}`}
        style={{ background: color }}
      />
    </div>
  );
}

export default function RoundHistoryStrip({
  rounds,
  targetWinRounds,
}: {
  rounds: RoundHistoryEntry[];
  targetWinRounds: number;
}) {
  if (!rounds || rounds.length === 0) return null;

  const regHalf = Math.max(1, targetWinRounds - 1);
  const columns = buildColumns(rounds, regHalf);

  return (
    <section className="mt-6">
      <div className="flex items-center justify-end mb-2">
        <div className="flex items-center gap-3 text-[10px] text-[var(--color-text-secondary)]">
          <LegendSwatch color={sideColor('T')} label="T" />
          <LegendSwatch color={sideColor('CT')} label="CT" />
        </div>
      </div>

      <div className="flex items-start gap-2">
        {/* Team track labels (top track = Shirts wins, bottom track = Skins wins) */}
        <div className="flex flex-col shrink-0 w-[40px] select-none text-right text-[var(--color-text-secondary)]">
          <div className="h-[34px] flex items-center justify-end font-display text-[11px] font-bold">
            Shirts
          </div>
          <div className="h-[34px] flex items-center justify-end font-display text-[11px] font-bold">
            Skins
          </div>
        </div>

        <div className="overflow-x-auto overflow-y-hidden flex-1">
          <div className="relative w-full min-w-max">
            {/* continuous center spine behind the columns */}
            <div className="pointer-events-none absolute left-0 right-0 top-[34px] h-px bg-[var(--color-border-primary)]" />
            <div className="relative flex items-stretch justify-between w-full">
            {columns.map((col, i) =>
              col.type === 'round' ? (
                <div key={`r${col.entry.n}`} className="flex flex-col w-[26px] shrink-0">
                  {/* top track (Shirts wins) */}
                  <div className="h-[34px] flex items-end justify-center">
                    {col.entry.winner === 'SHIRTS' && (
                      <RoundTile entry={col.entry} displayN={col.displayN} color={sideColor(col.entry.side)} />
                    )}
                  </div>
                  {/* bottom track (Skins wins) */}
                  <div className="h-[34px] flex items-start justify-center">
                    {col.entry.winner === 'SKINS' && (
                      <RoundTile entry={col.entry} displayN={col.displayN} color={sideColor(col.entry.side)} />
                    )}
                  </div>
                  <div className="h-[16px] flex items-center justify-center font-mono text-[9px] text-[var(--color-text-secondary)] tnum">
                    {col.displayN}
                  </div>
                </div>
              ) : col.type === 'empty' ? (
                <div
                  key={`e${col.n}`}
                  className="flex flex-col w-[26px] shrink-0"
                  title={`Round ${col.n} — not played`}
                >
                  {/* placeholder centered on the spine for an unplayed regulation round */}
                  <div className="h-[68px] flex items-center justify-center">
                    <div
                      className="h-[20px] w-[20px] rounded-[3px] border border-dashed border-[var(--color-border-primary)]"
                      style={{ background: 'color-mix(in srgb, var(--color-text-secondary) 6%, transparent)' }}
                    />
                  </div>
                  <div
                    className="h-[16px] flex items-center justify-center font-mono text-[9px] tnum"
                    style={{ color: 'color-mix(in srgb, var(--color-text-secondary) 55%, transparent)' }}
                  >
                    {col.n}
                  </div>
                </div>
              ) : (
                <div
                  key={`d${i}`}
                  className={`flex flex-col items-center shrink-0 ${col.major ? 'px-3' : 'px-1.5'}`}
                >
                  {/* track band: vertical cut with the phase label as a chip over it */}
                  <div className="relative h-[68px] flex justify-center">
                    <div
                      className={`w-px h-full ${col.major ? 'bg-[var(--color-border-secondary)]' : 'bg-[var(--color-border-primary)]'}`}
                    />
                    {col.label && (
                      <span className="absolute top-1/2 -translate-y-1/2 px-1 bg-[var(--color-bg-tertiary)] font-display text-[9px] font-bold tracking-wider text-[var(--color-text-primary)] leading-none">
                        {col.label}
                      </span>
                    )}
                  </div>
                  <div className="h-[16px] flex items-center justify-center font-mono text-[13px] font-semibold tnum whitespace-nowrap text-[var(--color-text-primary)]">
                    <span title="Shirts">{col.shirts}</span>
                    <span className="text-[var(--color-text-secondary)] mx-[2px]">–</span>
                    <span title="Skins">{col.skins}</span>
                  </div>
                </div>
              ),
            )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-[10px] w-[10px] rounded-[2px]"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}
