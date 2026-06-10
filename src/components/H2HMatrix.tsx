'use client';

import type { DuoStats, H2HStats } from '@/lib/queries';
import { duoBlendedScorer, rivalBlendedScorer } from '@/lib/queries';
import { firstName } from '@/lib/util';

export interface H2HPair {
  a: number;
  b: number;
  type: 'partner' | 'opponent';
}

function samePair(x: H2HPair | null, a: number, b: number): boolean {
  if (!x) return false;
  return (x.a === a && x.b === b) || (x.a === b && x.b === a);
}

/** Near-black base fading to green — uses bg-tertiary (darker than bg-secondary) for more contrast at the low end. */
function friendColor(score: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  return `color-mix(in srgb, var(--color-accent-green-fill) ${pct}%, var(--color-bg-tertiary))`;
}

/** Near-black base fading to red — score is pre-normalised to the dataset's actual range before this is called. */
function rivalColor(score: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  return `color-mix(in srgb, var(--color-accent-red-fg) ${pct}%, var(--color-bg-tertiary))`;
}

/** Cell styling for pairs that have never faced/partnered each other — distinct from a faint "even" or "no wins" record. */
const emptyCellCls = 'aspect-square flex items-center justify-center opacity-40';
const emptyCellStyle = { background: 'var(--color-bg-tertiary)' };

/**
 * Symmetric N×N relationship matrix. Upper triangle (row < col) shows the
 * friend blended score, colored from neutral to green; lower triangle (row >
 * col) shows the rival blended score, colored from neutral to red. Both use
 * the same normalised formula as the "Best Friends"/"Closest Rivals" cards —
 * see "Blended score" in GLOSSARY.md. Diagonal is empty.
 */
export default function H2HMatrix({
  players,
  duos,
  rivals,
  active,
  onHover,
  onSelect,
}: {
  players: { id: number; name: string; steam_avatar_url: string | null }[];
  duos: DuoStats[];
  rivals: H2HStats[];
  active: H2HPair | null;
  onHover: (pair: H2HPair | null) => void;
  onSelect: (pair: H2HPair) => void;
}) {
  const duoByPair = new Map<string, DuoStats>();
  for (const d of duos) {
    duoByPair.set(`${d.playerA}:${d.playerB}`, d);
    duoByPair.set(`${d.playerB}:${d.playerA}`, d);
  }
  const rivalByPair = new Map<string, H2HStats>();
  for (const r of rivals) {
    rivalByPair.set(`${r.playerA}:${r.playerB}`, r);
    rivalByPair.set(`${r.playerB}:${r.playerA}`, r);
  }

  const duoScore = duoBlendedScorer(duos);
  const rivalScore = rivalBlendedScorer(rivals);


  const n = players.length;

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <div className="px-5 py-2.5 border-b border-[var(--color-border-tertiary)] flex flex-wrap items-center justify-between gap-3">
        <span className="font-display text-[15px] font-semibold">Relationships</span>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-[8px] text-[var(--color-text-secondary)] flex items-center gap-1.5" title="More games + better results = Better partners">
            <span className="inline-block w-2 h-2" style={{ background: friendColor(0.75) }} />
            Stronger friends ↗
          </span>
          <span className="font-mono text-[8px] text-[var(--color-text-secondary)] flex items-center gap-1.5" title="More games + closer record = More notable rivals">
            <span className="inline-block w-2 h-2" style={{ background: rivalColor(0.75) }} />
            Closer rivals ↙
          </span>
        </div>
      </div>
      <div className="p-2 overflow-x-auto no-scrollbar">
        <div
          className="grid gap-[3px]"
          style={{ gridTemplateColumns: `52px repeat(${n}, 1fr)`, minWidth: 480 }}
        >
          <div />
          {players.map((p) => (
            <div key={p.id} className="relative h-11" title={p.name}>
              <span
                className="absolute bottom-0 left-1/2 origin-bottom-left -rotate-45 whitespace-nowrap font-mono text-[10px] pl-0.5"
                style={{ color: active && (active.a === p.id || active.b === p.id) ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}
              >
                {firstName(p.name)}
              </span>
            </div>
          ))}
          {players.map((row, ri) => (
            <div key={row.id} className="contents">
              <div
                className="font-mono text-[10px] flex items-center justify-end pr-1.5 truncate"
                title={row.name}
                style={{ color: active && (active.a === row.id || active.b === row.id) ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}
              >
                {firstName(row.name)}
              </div>
              {players.map((col, ci) => {
                if (ri === ci) {
                  return (
                    <div key={col.id} className={emptyCellCls} style={emptyCellStyle}>
                      <span className="font-mono text-[8px] text-[var(--color-text-secondary)]">—</span>
                    </div>
                  );
                }

                const isPartner = ri < ci;
                const isHot = samePair(active, row.id, col.id);
                const cellCls = `aspect-square flex items-center justify-center cursor-pointer transition-[outline] outline outline-2 ${isHot ? 'outline-[var(--color-text-primary)]' : 'outline-transparent'}`;

                if (isPartner) {
                  const d = duoByPair.get(`${row.id}:${col.id}`);
                  if (!d) {
                    return (
                      <div key={col.id} className={emptyCellCls} style={emptyCellStyle}>
                        <span className="font-mono text-[8px] text-[var(--color-text-secondary)]">—</span>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={col.id}
                      className={cellCls}
                      style={{ background: friendColor(duoScore(d)) }}
                      onMouseEnter={() => onHover({ a: row.id, b: col.id, type: 'partner' })}
                      onMouseLeave={() => onHover(null)}
                      onClick={() => onSelect({ a: row.id, b: col.id, type: 'partner' })}
                    >
                      <span className="font-mono text-[9px] font-semibold text-white/85">{d.wins}–{d.losses}</span>
                    </div>
                  );
                }

                const r = rivalByPair.get(`${row.id}:${col.id}`);
                if (!r) {
                  return (
                    <div key={col.id} className={emptyCellCls} style={emptyCellStyle}>
                      <span className="font-mono text-[8px] text-[var(--color-text-secondary)]">—</span>
                    </div>
                  );
                }
                const rowWins = r.playerA === row.id ? r.aWins : r.bWins;
                const colWins = r.playerA === col.id ? r.aWins : r.bWins;
                return (
                  <div
                    key={col.id}
                    className={cellCls}
                    style={{ background: rivalColor(rivalScore(r)) }}
                    onMouseEnter={() => onHover({ a: row.id, b: col.id, type: 'opponent' })}
                    onMouseLeave={() => onHover(null)}
                    onClick={() => onSelect({ a: row.id, b: col.id, type: 'opponent' })}
                  >
                    <span className="font-mono text-[9px] font-semibold text-white/85">{rowWins}–{colWins}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex justify-center gap-5 mt-2.5">
          <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">
            ↗ upper = <span className="text-[var(--color-accent-green-fg)]">friend score</span>
          </span>
          <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">
            ↙ lower = <span className="text-[var(--color-accent-red-fg)]">rival score</span>
          </span>
        </div>
      </div>
    </div>
  );
}
