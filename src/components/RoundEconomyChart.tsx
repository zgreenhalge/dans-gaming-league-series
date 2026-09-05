'use client';

import { useMemo, useState } from 'react';
import type { MatchKillRow, MatchDamageEventRow, MatchRoundEconomyRow } from '@/lib/queries';
import type { RoundHistoryEntry } from '@/lib/types';
import { sideColor } from '@/lib/util';
import { useElementWidth } from './useElementWidth';

const CHART_HEIGHT = 220;

type Side = 'CT' | 'T' | null;

const PADDING = { top: 16, right: 16, bottom: 24, left: 44 };
const DOT_R = 3;

/** `sideColor()` (`@/lib/util`) returns `undefined` for a null/unresolved side so a text-color
 *  caller can fall through to the default; this chart always needs a concrete stroke/fill color,
 *  so it falls back to the neutral secondary-text color instead of leaving one un-set. */
function lineColor(side: Side): string {
  return sideColor(side) ?? 'var(--color-text-secondary)';
}

/** Lightened/darkened tints of a team's base side color for its two individual players — keeps
 *  each player visually tied to their team's hue (still obviously "same family" as the bold team
 *  total line below) while giving the two teammates genuinely different colors, not just a dash
 *  pattern. The dash on the second player is kept anyway as a redundant, colorblind-safe cue. */
function playerTint(side: Side, indexOnSide: number): string {
  const base = lineColor(side);
  return indexOnSide === 0
    ? `color-mix(in srgb, ${base} 70%, white 30%)`
    : `color-mix(in srgb, ${base} 70%, black 30%)`;
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
  side: Side;
  color: string;
  /** The second player sharing a side is drawn dashed so two teammates' lines stay
   *  distinguishable even for a colorblind viewer, on top of their different color tints. */
  dashed: boolean;
  points: RoundPoint[];
}

interface TeamLine {
  key: 'shirts' | 'skins';
  label: string;
  color: string;
  /** `null` only when neither of the team's two players has a value for that round (both dropped
   *  by a parser miss) — a single missing player's round is still summed as the other's value. */
  points: { round: number; money: number | null }[];
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
  roundHistory,
  teamSides,
}: {
  players: { id: number; name: string; side: Side }[];
  roundEconomy: MatchRoundEconomyRow[];
  kills: MatchKillRow[];
  damageEvents: MatchDamageEventRow[];
  /** This match's round-by-round outcomes (`matches.round_history`) — drives the background
   *  win/loss bands. Joins directly against `roundEconomy.round_number` with no offset math; see
   *  `RoundHistoryEntry.n`'s own doc comment for why. Empty is fine; rounds simply render with no
   *  band. */
  roundHistory: RoundHistoryEntry[];
  /** Each team's match-long display side (`shirtsF`/`skinsF` in `MatchTabView`/`Scoreboard`) — a
   *  round's winning band is tinted by the *team* that won it, mapped through this to the same
   *  fixed color that team's own player lines use, not the round's actual (half-swapping) side. */
  teamSides: { shirts: Side; skins: Side };
}) {
  const [containerRef, width] = useElementWidth(320, 600);
  const [hoverRound, setHoverRound] = useState<number | null>(null);

  const { rounds, lines, teamLines, yMax, roundBands } = useMemo(() => {
    const roundSet = new Set<number>();
    for (const r of roundEconomy) roundSet.add(r.round_number);
    const rounds = [...roundSet].sort((a, b) => a - b);

    const outcomeByRound = new Map(roundHistory.map((e) => [e.n, e]));
    const roundBands = rounds.map((r) => {
      const winner = outcomeByRound.get(r) ?? null;
      const color = winner ? lineColor(winner.winner === 'SHIRTS' ? teamSides.shirts : teamSides.skins) : null;
      return { winner, color };
    });

    // One pass each over roundEconomy/kills/damageEvents, keyed by "round-player", so the
    // per-player-per-round loop below is a Map lookup instead of a fresh scan of each array.
    const key = (round: number, playerId: number) => `${round}-${playerId}`;
    const moneyByKey = new Map(roundEconomy.map((r) => [key(r.round_number, r.player_id), r.equipment_value]));
    const killsByKey = new Map<string, number>();
    for (const k of kills) {
      if (k.attacker_player_id == null) continue;
      const k2 = key(k.round_number, k.attacker_player_id);
      killsByKey.set(k2, (killsByKey.get(k2) ?? 0) + 1);
    }
    const damageByKey = new Map<string, number>();
    for (const d of damageEvents) {
      if (d.attacker_player_id == null || d.attacker_player_id === d.victim_player_id) continue;
      const k = key(d.round_number, d.attacker_player_id);
      damageByKey.set(k, (damageByKey.get(k) ?? 0) + d.damage);
    }

    // A side can hold at most two players; the second one drawn for a side is dashed so
    // teammates stay distinguishable without a second color per side.
    const seenPerSide = new Map<string, number>();

    const lines: PlayerLine[] = players.map((p) => {
      const sideKey = String(p.side);
      const seenCount = seenPerSide.get(sideKey) ?? 0;
      seenPerSide.set(sideKey, seenCount + 1);

      const points: RoundPoint[] = rounds.map((round) => {
        const k = key(round, p.id);
        const money = moneyByKey.get(k) ?? null;
        return { round, money, kills: killsByKey.get(k) ?? 0, damage: damageByKey.get(k) ?? 0 };
      });

      return { id: p.id, name: p.name, side: p.side, color: playerTint(p.side, seenCount), dashed: seenCount === 1, points };
    });

    // Team totals: a flat sum of both teammates' money each round, one line per team, in the
    // team's own undiluted color (bold/thick, see render below) so it reads as the "headline"
    // line the two tinted player lines are a breakdown of.
    const teamLines: TeamLine[] = (['shirts', 'skins'] as const).map((teamKey) => {
      const side = teamSides[teamKey];
      const members = lines.filter((l) => l.side === side);
      const points = rounds.map((round, i) => {
        const values = members.map((m) => m.points[i].money).filter((v): v is number => v != null);
        return { round, money: values.length > 0 ? values.reduce((a, b) => a + b, 0) : null };
      });
      return { key: teamKey, label: teamKey === 'shirts' ? 'Shirts Total' : 'Skins Total', color: lineColor(side), points };
    });

    const dataMax = Math.max(
      0,
      ...lines.flatMap((l) => l.points.map((p) => p.money ?? 0)),
      ...teamLines.flatMap((l) => l.points.map((p) => p.money ?? 0)),
    );
    const yMax = Math.max(1000, Math.ceil((dataMax * 1.15) / 500) * 500);
    return { rounds, lines, teamLines, yMax, roundBands };
  }, [players, roundEconomy, kills, damageEvents, roundHistory, teamSides]);

  if (rounds.length === 0) return null;

  const height = CHART_HEIGHT;
  const plotW = width - PADDING.left - PADDING.right;
  const plotH = height - PADDING.top - PADDING.bottom;
  const span = Math.max(1, rounds.length - 1);

  const xFor = (i: number) => PADDING.left + (i / span) * plotW;
  const yFor = (v: number) => PADDING.top + plotH - (v / yMax) * plotH;

  const yTickCount = 4;
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) => (yMax * i) / yTickCount);

  function pathFor(points: { money: number | null }[]): string {
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
        {teamLines.map((t) => (
          <span key={t.key} className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[var(--color-text-secondary)]">
            <svg width="16" height="8" aria-hidden="true">
              <line x1={0} x2={16} y1={4} y2={4} stroke={t.color} strokeWidth={3} />
            </svg>
            {t.label}
          </span>
        ))}
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
        <span className="text-[10px] text-[var(--color-text-secondary)]">— background tints the round winner</span>
      </div>

      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block', overflow: 'visible' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverRound(null)}
      >
        {(() => {
          const colWidth = plotW / rounds.length;
          return rounds.map((r, i) => {
            const color = roundBands[i].color;
            if (!color) return null;
            return (
              <rect
                key={r}
                x={xFor(i) - colWidth / 2}
                y={PADDING.top}
                width={colWidth}
                height={plotH}
                fill={color}
                fillOpacity={0.1}
              />
            );
          });
        })()}

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

        {/* Team totals draw first (thick, undiluted color) so the two tinted per-player lines/
            markers read as a breakdown layered on top, not the other way around. */}
        {teamLines.map((t) => (
          <path key={t.key} d={pathFor(t.points)} fill="none" stroke={t.color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
        ))}

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
          const tooltipW = 175;
          const tooltipH = 20 + (teamLines.length + lines.length) * 14;
          let tx = xFor(hoverIdx) - tooltipW / 2;
          if (tx < PADDING.left) tx = PADDING.left;
          if (tx + tooltipW > width - PADDING.right) tx = width - PADDING.right - tooltipW;
          const ty = PADDING.top;
          return (
            <g style={{ pointerEvents: 'none' }}>
              <rect x={tx} y={ty} width={tooltipW} height={tooltipH} rx={4} fill="var(--color-bg-secondary)" stroke="var(--color-border-primary)" strokeWidth={1} />
              <text x={tx + 8} y={ty + 13} fill="var(--color-text-primary)" fontSize={10} fontFamily="monospace" fontWeight={600}>
                Round {rounds[hoverIdx]}{roundBands[hoverIdx].winner ? ` — ${roundBands[hoverIdx].winner!.winner === 'SHIRTS' ? 'Shirts' : 'Skins'} won` : ''}
              </text>
              {teamLines.map((t, i) => {
                const p = t.points[hoverIdx];
                return (
                  <text key={t.key} x={tx + 8} y={ty + 28 + i * 14} fontSize={9} fontFamily="monospace" fontWeight={600} fill="var(--color-text-primary)">
                    <tspan fill={t.color}>{'●'} </tspan>
                    {t.label}: {p.money != null ? `$${p.money}` : '—'}
                  </text>
                );
              })}
              {lines.map((l, i) => {
                const p = l.points[hoverIdx];
                return (
                  <text key={l.id} x={tx + 8} y={ty + 28 + (teamLines.length + i) * 14} fontSize={9} fontFamily="monospace" fill="var(--color-text-primary)">
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
