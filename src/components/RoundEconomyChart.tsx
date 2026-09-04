'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MatchKillRow, MatchDamageEventRow, MatchRoundEconomyRow } from '@/lib/queries';

type Side = 'CT' | 'T' | null;

const PADDING = { top: 16, right: 16, bottom: 24, left: 44 };
const DOT_R = 3;

/** CSS color for a side, matching the site-wide CT=blue / T=orange convention
 *  (`RoundHistoryStrip.tsx`'s own `sideColor()`). */
function sideColor(side: Side): string {
  if (side === 'T') return 'var(--color-t)';
  if (side === 'CT') return 'var(--color-ct)';
  return 'var(--color-text-secondary)';
}

interface RoundPoint {
  round: number;
  money: number | null;
  kills: number;
  damage: number;
}

interface PlayerLine {
  id: number;
  name: string;
  color: string;
  /** The second player sharing a side is drawn dashed so two teammates' lines stay
   *  distinguishable without needing a second color per side. */
  dashed: boolean;
  points: RoundPoint[];
}

/** Round-by-round equipment value (money), with kills/damage surfaced on hover — the Economy
 *  sub-tab's round timeline (#519), a finer grain than the tier-bucketed `EconomyTable` below it.
 *  One line per player, grouped/colored by side rather than by SHIRTS/SKINS identity, matching
 *  `Scoreboard`/`TeamHeader`'s own convention of tinting each team by its match-long display side. */
export default function RoundEconomyChart({
  players,
  roundEconomy,
  kills,
  damageEvents,
}: {
  players: { id: number; name: string; side: Side }[];
  roundEconomy: MatchRoundEconomyRow[];
  kills: MatchKillRow[];
  damageEvents: MatchDamageEventRow[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 600, h: 220 });
  const [hoverRound, setHoverRound] = useState<number | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setDims({ w: Math.max(320, entry.contentRect.width), h: 220 });
    });
    observer.observe(node);
    setDims({ w: Math.max(320, node.clientWidth), h: 220 });
    return () => observer.disconnect();
  }, []);

  const { rounds, lines, yMax } = useMemo(() => {
    const roundSet = new Set<number>();
    for (const r of roundEconomy) roundSet.add(r.round_number);
    const rounds = [...roundSet].sort((a, b) => a - b);

    // A side can hold at most two players; the second one drawn for a side is dashed so
    // teammates stay distinguishable without a second color per side.
    const seenPerSide = new Map<string, number>();

    const lines: PlayerLine[] = players.map((p) => {
      const sideKey = String(p.side);
      const seenCount = seenPerSide.get(sideKey) ?? 0;
      seenPerSide.set(sideKey, seenCount + 1);

      const points: RoundPoint[] = rounds.map((round) => {
        const moneyRow = roundEconomy.find((r) => r.round_number === round && r.player_id === p.id);
        const roundKills = kills.filter((k) => k.round_number === round && k.attacker_player_id === p.id).length;
        let roundDamage = 0;
        for (const d of damageEvents) {
          if (d.round_number === round && d.attacker_player_id === p.id && d.victim_player_id !== p.id) {
            roundDamage += d.damage;
          }
        }
        const money = moneyRow ? moneyRow.equipment_value : null;
        return { round, money, kills: roundKills, damage: roundDamage };
      });

      return { id: p.id, name: p.name, color: sideColor(p.side), dashed: seenCount === 1, points };
    });

    const dataMax = Math.max(0, ...lines.flatMap((l) => l.points.map((p) => p.money ?? 0)));
    const yMax = Math.max(1000, Math.ceil((dataMax * 1.15) / 500) * 500);
    return { rounds, lines, yMax };
  }, [players, roundEconomy, kills, damageEvents]);

  if (rounds.length === 0) return null;

  const width = dims.w;
  const height = dims.h;
  const plotW = width - PADDING.left - PADDING.right;
  const plotH = height - PADDING.top - PADDING.bottom;
  const span = Math.max(1, rounds.length - 1);

  const xFor = (i: number) => PADDING.left + (i / span) * plotW;
  const yFor = (v: number) => PADDING.top + plotH - (v / yMax) * plotH;

  const yTickCount = 4;
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) => (yMax * i) / yTickCount);

  function pathFor(points: RoundPoint[]): string {
    let d = '';
    let open = false;
    points.forEach((p, i) => {
      if (p.money == null) {
        open = false;
        return;
      }
      const x = xFor(i).toFixed(1);
      const y = yFor(p.money).toFixed(1);
      d += open ? ` L${x} ${y}` : `${d ? ' ' : ''}M${x} ${y}`;
      open = true;
    });
    return d;
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let closest = 0;
    let closestDist = Infinity;
    rounds.forEach((_, i) => {
      const d = Math.abs(xFor(i) - mx);
      if (d < closestDist) {
        closestDist = d;
        closest = i;
      }
    });
    setHoverRound(closestDist < plotW / span ? rounds[closest] : null);
  }

  const hoverIdx = hoverRound != null ? rounds.indexOf(hoverRound) : -1;

  return (
    <div ref={containerRef}>
      <div className="flex flex-wrap items-center gap-4 mb-2">
        {lines.map((l) => (
          <span key={l.id} className="inline-flex items-center gap-1.5 text-[10px] text-[var(--color-text-secondary)]">
            <svg width="16" height="8" aria-hidden="true">
              <line
                x1={0} x2={16} y1={4} y2={4}
                stroke={l.color}
                strokeWidth={2}
                strokeDasharray={l.dashed ? '3,2' : undefined}
              />
            </svg>
            {l.name}
          </span>
        ))}
      </div>

      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block', overflow: 'visible' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverRound(null)}
      >
        {yTicks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick}>
              <line x1={PADDING.left} x2={width - PADDING.right} y1={y} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
              <text x={PADDING.left - 6} y={y} textAnchor="end" dominantBaseline="central" fill="var(--color-text-secondary)" fontSize={9} fontFamily="monospace">
                ${Math.round(tick / 100) / 10}k
              </text>
            </g>
          );
        })}

        {rounds.map((r, i) => (
          <text key={r} x={xFor(i)} y={height - 6} textAnchor="middle" fill="var(--color-text-secondary)" fontSize={9} fontFamily="monospace">
            {r}
          </text>
        ))}

        {hoverIdx >= 0 && (
          <line x1={xFor(hoverIdx)} x2={xFor(hoverIdx)} y1={PADDING.top} y2={PADDING.top + plotH} stroke="var(--color-border-secondary)" strokeWidth={1} strokeDasharray="3,3" />
        )}

        {lines.map((l) => (
          <path key={l.id} d={pathFor(l.points)} fill="none" stroke={l.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={l.dashed ? '5,3' : undefined} />
        ))}

        {lines.map((l) =>
          l.points.map((p, i) => {
            if (p.money == null) return null;
            const r = p.kills > 0 ? Math.min(10, DOT_R + p.kills * 2.5) : DOT_R;
            return (
              <g key={`${l.id}-${p.round}`}>
                <circle cx={xFor(i)} cy={yFor(p.money)} r={r} fill={p.kills > 0 ? l.color : 'var(--color-bg-primary)'} stroke={l.color} strokeWidth={1.5} />
                {p.kills > 1 && (
                  <text x={xFor(i)} y={yFor(p.money)} textAnchor="middle" dominantBaseline="central" fill="var(--color-bg-primary)" fontSize={8} fontWeight={700}>
                    {p.kills}
                  </text>
                )}
              </g>
            );
          }),
        )}

        {hoverIdx >= 0 && (() => {
          const tooltipW = 150;
          const tooltipH = 20 + lines.length * 14;
          let tx = xFor(hoverIdx) - tooltipW / 2;
          if (tx < PADDING.left) tx = PADDING.left;
          if (tx + tooltipW > width - PADDING.right) tx = width - PADDING.right - tooltipW;
          const ty = PADDING.top;
          return (
            <g style={{ pointerEvents: 'none' }}>
              <rect x={tx} y={ty} width={tooltipW} height={tooltipH} rx={4} fill="var(--color-bg-secondary)" stroke="var(--color-border-primary)" strokeWidth={1} />
              <text x={tx + 8} y={ty + 13} fill="var(--color-text-primary)" fontSize={10} fontFamily="monospace" fontWeight={600}>
                Round {rounds[hoverIdx]}
              </text>
              {lines.map((l, i) => {
                const p = l.points[hoverIdx];
                return (
                  <text key={l.id} x={tx + 8} y={ty + 28 + i * 14} fontSize={9} fontFamily="monospace" fill="var(--color-text-primary)">
                    <tspan fill={l.color}>{'●'} </tspan>
                    {p.money != null ? `$${p.money}` : '—'} · {p.kills}K · {p.damage}D
                  </text>
                );
              })}
            </g>
          );
        })()}
      </svg>
    </div>
  );
}
