'use client';

import { useMemo, useState } from 'react';
import { ALL_ECONOMY_TIERS, type MatchKillRow, type MatchRoundEconomyRow } from '@/lib/queries';
import type { RoundHistoryEntry } from '@/lib/types';
import type { EconomyType } from '@/lib/parsers/economy';
import { sideColor } from '@/lib/util';
import { useElementWidth } from './useElementWidth';

const CHART_HEIGHT = 220;

type Side = 'CT' | 'T' | null;

const PADDING = { top: 16, right: 16, bottom: 24, left: 44 };
const DOT_R = 3;
/** Player lines are always dashed or dotted, team-total lines always solid — the stroke style
 *  itself marks a line as an individual vs. the team's combined total. The two teammates on a
 *  side additionally get different patterns (dashed vs. dotted, indexed by `playerColor()`'s
 *  same `indexOnSide`) so their lines stay distinguishable by stroke alone, not just color, even
 *  where the two paths cross or run close together. */
const PLAYER_DASH: readonly [string, string] = ['5,3', '1,5'];

/** `sideColor()` (`@/lib/util`) returns `undefined` for a null/unresolved side so a text-color
 *  caller can fall through to the default; this chart always needs a concrete stroke/fill color,
 *  so it falls back to the neutral secondary-text color instead of leaving one un-set. */
function lineColor(side: Side): string {
  return sideColor(side) ?? 'var(--color-text-secondary)';
}

/** A team's two players each get their own hue, matching CS2's own selectable player colors
 *  rather than a lighten/darken tint of one base hue — the first player on a side shares the
 *  team-total line's own color (solid vs. dashed strokes keep the two apart, see the render
 *  below), the second gets the paired hue: green alongside CT's blue, yellow alongside T's
 *  orange. */
function playerColor(side: Side, indexOnSide: number): string {
  if (indexOnSide === 0) return lineColor(side);
  if (side === 'CT') return 'var(--color-accent-green-fg)';
  if (side === 'T') return 'var(--color-accent-yellow-fg)';
  return lineColor(side);
}

interface RoundPoint {
  round: number;
  money: number | null;
  kills: number;
  economyType: EconomyType | null;
  /** Whether this round matches the Economy sub-tab's selected tier filter — always `true` under
   *  `ALL_ECONOMY_TIERS` (nothing to dim against). Drives the line/marker dimming below. */
  matchesFilter: boolean;
}

interface PlayerLine {
  id: number;
  name: string;
  side: Side;
  color: string;
  dashArray: string;
  points: RoundPoint[];
}

interface TeamPoint {
  round: number;
  /** `null` only when neither of the team's two players has a value for that round (both dropped
   *  by a parser miss) — a single missing player's round is still summed as the other's value. */
  money: number | null;
  /** True only when *both* teammates matched the selected filter that round — a genuine team eco/
   *  force/full round, not just "one of the two happened to." */
  matchesFilter: boolean;
}

interface TeamLine {
  key: 'shirts' | 'skins';
  label: string;
  color: string;
  points: TeamPoint[];
}

/** Round-by-round equipment value (money), with kills surfaced on hover — the Economy sub-tab's
 *  round timeline (#519), a finer grain than the tier-bucketed `EconomyTable` below it. One line
 *  per player, grouped/colored by side rather than by SHIRTS/SKINS identity, matching
 *  `Scoreboard`/`TeamHeader`'s own convention of tinting each team by its match-long display side. */
export default function RoundEconomyChart({
  players,
  roundEconomy,
  kills,
  roundHistory,
  teamSides,
  selectedTier,
}: {
  players: { id: number; name: string; side: Side }[];
  roundEconomy: MatchRoundEconomyRow[];
  kills: MatchKillRow[];
  /** This match's round-by-round outcomes (`matches.round_history`) — drives the background
   *  win/loss bands. Joins directly against `roundEconomy.round_number` with no offset math; see
   *  `RoundHistoryEntry.n`'s own doc comment for why. Empty is fine; rounds simply render with no
   *  band. */
  roundHistory: RoundHistoryEntry[];
  /** Each team's match-long display side (`shirtsF`/`skinsF` in `MatchTabView`/`Scoreboard`) — a
   *  round's winning band is tinted by the *team* that won it, mapped through this to the same
   *  fixed color that team's own player lines use, not the round's actual (half-swapping) side. */
  teamSides: { shirts: Side; skins: Side };
  /** The Economy sub-tab's shared tier filter (`economyFilter` in `SabremetricsLeaderboardView`) —
   *  dims a player's line/marker for any round that isn't their own `economy_type` that round, and
   *  a team-total line for any round where either teammate didn't match. `ALL_ECONOMY_TIERS`
   *  (the default) dims nothing. */
  selectedTier: string;
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

    // One pass each over roundEconomy/kills, keyed by "round-player", so the per-player-per-round
    // loop below is a Map lookup instead of a fresh scan of each array.
    const key = (round: number, playerId: number) => `${round}-${playerId}`;
    const econByKey = new Map(roundEconomy.map((r) => [key(r.round_number, r.player_id), r]));
    const killsByKey = new Map<string, number>();
    for (const k of kills) {
      if (k.attacker_player_id == null) continue;
      const k2 = key(k.round_number, k.attacker_player_id);
      killsByKey.set(k2, (killsByKey.get(k2) ?? 0) + 1);
    }

    // A side can hold at most two players; each gets its own color (see `playerColor()`), keyed
    // by which one is seen first for that side.
    const seenPerSide = new Map<string, number>();

    const lines: PlayerLine[] = players.map((p) => {
      const sideKey = String(p.side);
      const seenCount = seenPerSide.get(sideKey) ?? 0;
      seenPerSide.set(sideKey, seenCount + 1);

      const points: RoundPoint[] = rounds.map((round) => {
        const k = key(round, p.id);
        const econRow = econByKey.get(k);
        const economyType = (econRow?.economy_type as EconomyType) ?? null;
        const matchesFilter = selectedTier === ALL_ECONOMY_TIERS || economyType === selectedTier;
        return {
          round,
          money: econRow?.equipment_value ?? null,
          kills: killsByKey.get(k) ?? 0,
          economyType,
          matchesFilter,
        };
      });

      return {
        id: p.id, name: p.name, side: p.side,
        color: playerColor(p.side, seenCount),
        dashArray: PLAYER_DASH[Math.min(seenCount, PLAYER_DASH.length - 1)],
        points,
      };
    });

    // Team totals: a flat sum of both teammates' money each round, one line per team, solid and
    // bold/thick (see render below) so it reads as the "headline" line the two dashed player
    // lines are a breakdown of. A team round only "matches" the selected filter when both
    // teammates individually did — a genuine team eco/force/full round, not just one of the two
    // happening to.
    const teamLines: TeamLine[] = (['shirts', 'skins'] as const).map((teamKey) => {
      const side = teamSides[teamKey];
      const members = lines.filter((l) => l.side === side);
      const points: TeamPoint[] = rounds.map((round, i) => {
        const memberPoints = members.map((m) => m.points[i]);
        const values = memberPoints.map((p) => p.money).filter((v): v is number => v != null);
        return {
          round,
          money: values.length > 0 ? values.reduce((a, b) => a + b, 0) : null,
          matchesFilter: memberPoints.every((p) => p.matchesFilter),
        };
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
  }, [players, roundEconomy, kills, roundHistory, teamSides, selectedTier]);

  if (rounds.length === 0) return null;

  const height = CHART_HEIGHT;
  const plotW = width - PADDING.left - PADDING.right;
  const plotH = height - PADDING.top - PADDING.bottom;
  const span = Math.max(1, rounds.length - 1);

  const xFor = (i: number) => PADDING.left + (i / span) * plotW;
  const yFor = (v: number) => PADDING.top + plotH - (v / yMax) * plotH;

  const yTickCount = 4;
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) => (yMax * i) / yTickCount);

  /** Builds one path through `points`, breaking (a fresh `M`) at any point with no money or,
   *  when `onlyWhere` is given, at any point it excludes — used to draw a "bright overlay" of just
   *  the filter-matching stretches on top of a dimmed full line (see `hasFilter` below). */
  function pathFor(points: { money: number | null }[], onlyWhere?: (i: number) => boolean): string {
    let d = '';
    let open = false;
    points.forEach((p, i) => {
      if (p.money == null || (onlyWhere && !onlyWhere(i))) {
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

  const hasFilter = selectedTier !== ALL_ECONOMY_TIERS;
  const DIMMED_OPACITY = 0.22;

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
              <line x1={0} x2={16} y1={4} y2={4} stroke={l.color} strokeWidth={2} strokeLinecap="round" strokeDasharray={l.dashArray} />
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

        {/* Team totals draw first (thick, solid) so the two dashed per-player lines/markers read
            as a breakdown layered on top, not the other way around. When a tier filter is
            active, the full line draws dimmed and a second, full-opacity "bright" overlay
            traces only the rounds that matched (both teammates, for a team line) — two layers
            of the same path rather than variable per-segment opacity. */}
        {teamLines.map((t) => (
          <g key={t.key}>
            <path d={pathFor(t.points)} fill="none" stroke={t.color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" opacity={hasFilter ? DIMMED_OPACITY : 0.85} />
            {hasFilter && (
              <path d={pathFor(t.points, (i) => t.points[i].matchesFilter)} fill="none" stroke={t.color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
            )}
          </g>
        ))}

        {lines.map((l) => (
          <g key={l.id}>
            <path d={pathFor(l.points)} fill="none" stroke={l.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={l.dashArray} opacity={hasFilter ? DIMMED_OPACITY : 1} />
            {hasFilter && (
              <path d={pathFor(l.points, (i) => l.points[i].matchesFilter)} fill="none" stroke={l.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={l.dashArray} />
            )}
          </g>
        ))}

        {lines.map((l) =>
          l.points.map((p, i) => {
            if (p.money == null) return null;
            const r = p.kills > 0 ? Math.min(10, DOT_R + p.kills * 2.5) : DOT_R;
            const dimmed = hasFilter && !p.matchesFilter;
            return (
              <g key={`${l.id}-${p.round}`} opacity={dimmed ? DIMMED_OPACITY : 1}>
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
          const tooltipW = 190;
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
                    {l.name}: {p.money != null ? `$${p.money}` : '—'}
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
