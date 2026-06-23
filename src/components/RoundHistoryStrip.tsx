import { Skull, Bomb, Scissors, Clock } from 'lucide-react';
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

const CONDITION_ICON: Record<RoundCondition, typeof Skull> = {
  elim: Skull,
  bomb: Bomb,
  defuse: Scissors,
  time: Clock,
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
  | { type: 'round'; entry: RoundHistoryEntry }
  | { type: 'empty'; n: number }
  | { type: 'divider'; label: string; major: boolean; shirts: number; skins: number };

function buildColumns(
  rounds: RoundHistoryEntry[],
  regHalf: number,
): Column[] {
  const cols: Column[] = [];
  let shirts = 0;
  let skins = 0;
  for (let i = 0; i < rounds.length; i++) {
    const entry = rounds[i];
    cols.push({ type: 'round', entry });
    if (entry.winner === 'SHIRTS') shirts++;
    else skins++;

    const next = rounds[i + 1];
    if (next) {
      const segHere = segmentOf(entry.n, regHalf);
      const segNext = segmentOf(next.n, regHalf);
      if (segNext !== segHere) {
        const { label, major } = dividerLabel(segNext);
        cols.push({ type: 'divider', label, major, shirts, skins });
      }
    }
  }

  // If the game was clinched in regulation (no overtime), pad out the remaining
  // regulation rounds as greyed-out "unplayed" placeholders.
  const lastN = rounds.length > 0 ? rounds[rounds.length - 1].n : 0;
  const regMax = 2 * regHalf;
  if (lastN < regMax) {
    for (let n = lastN + 1; n <= regMax; n++) {
      cols.push({ type: 'empty', n });
    }
  }

  return cols;
}

function RoundTile({ entry, color }: { entry: RoundHistoryEntry; color: string }) {
  const Icon = CONDITION_ICON[entry.condition];
  const onTop = entry.winner === 'SHIRTS';
  const teamName = entry.winner === 'SHIRTS' ? 'Shirts' : 'Skins';
  return (
    <div
      title={`Round ${entry.n} — ${teamName} won (${CONDITION_LABEL[entry.condition]}), ${entry.side} side`}
      className="relative h-[26px] w-[26px] rounded-[3px] border flex items-center justify-center"
      style={{
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
      }}
    >
      <Icon size={15} strokeWidth={2.25} style={{ color }} />
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
                      <RoundTile entry={col.entry} color={sideColor(col.entry.side)} />
                    )}
                  </div>
                  {/* bottom track (Skins wins) */}
                  <div className="h-[34px] flex items-start justify-center">
                    {col.entry.winner === 'SKINS' && (
                      <RoundTile entry={col.entry} color={sideColor(col.entry.side)} />
                    )}
                  </div>
                  <div className="h-[16px] flex items-center justify-center font-mono text-[9px] text-[var(--color-text-secondary)] tnum">
                    {col.entry.n}
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
