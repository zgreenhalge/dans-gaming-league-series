'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { EhogRatingPoint } from '@/lib/queries';
import { seasonTitle } from '@/lib/util';

const PADDING = { top: 16, right: 16, bottom: 24, left: 40 };
const DOT_R = 4;
const HOVER_R = 7;

function formatLabel(p: EhogRatingPoint): string {
  const st = seasonTitle(p.seasonName);
  const prefix = p.isGauntlet ? 'G' : 'W';
  return `${st} ${prefix}${p.weekNumber} M${p.matchNumber}`;
}

export default function EhogTimeline({
  history,
}: {
  history: EhogRatingPoint[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverReset, setHoverReset] = useState<number | null>(null);
  const [dims, setDims] = useState({ w: 600, h: 180 });

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDims({ w: Math.max(300, entry.contentRect.width), h: 180 });
      }
    });
    observer.observe(node);
    setDims({ w: Math.max(300, node.clientWidth), h: 180 });
    return () => observer.disconnect();
  }, []);

  const width = dims.w;
  const height = dims.h;
  const plotW = width - PADDING.left - PADDING.right;
  const plotH = height - PADDING.top - PADDING.bottom;

  const { points, yMin, yMax, yTicks } = useMemo(() => {
    if (history.length === 0) return { points: [], yMin: 10, yMax: 100, yTicks: [] };
    const ratings = history.map((h) => h.ehogRating);
    const rawMin = Math.min(...ratings);
    const rawMax = Math.max(...ratings);
    const pad = Math.max(2, (rawMax - rawMin) * 0.1);
    const yMin = Math.max(10, Math.floor(rawMin - pad));
    const yMax = Math.min(100, Math.ceil(rawMax + pad));
    const range = yMax - yMin || 1;
    const span = Math.max(1, history.length - 1);

    const pts = history.map((h, i) => ({
      x: PADDING.left + (i / span) * plotW,
      y: PADDING.top + plotH - ((h.ehogRating - yMin) / range) * plotH,
    }));

    const tickCount = 4;
    const yTicks = Array.from({ length: tickCount + 1 }, (_, i) =>
      yMin + (range * i) / tickCount,
    );

    return { points: pts, yMin, yMax, yTicks };
  }, [history, plotW, plotH]);

  if (history.length === 0) return null;

  const fullLinePath = points
    .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');

  const areaPath = `${fullLinePath} L ${points[points.length - 1].x.toFixed(1)} ${PADDING.top + plotH} L ${points[0].x.toFixed(1)} ${PADDING.top + plotH} Z`;

  const decayBoundarySet = new Set<number>();
  const seasonBoundaries: { x: number; label: string }[] = [];
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const cur = history[i];
    if (cur.seasonNumber !== prev.seasonNumber || cur.isGauntlet !== prev.isGauntlet) {
      const isRegularToGauntlet = !prev.isGauntlet && cur.isGauntlet && cur.seasonNumber === prev.seasonNumber;
      if (!isRegularToGauntlet) decayBoundarySet.add(i);
      seasonBoundaries.push({
        x: (points[i - 1].x + points[i].x) / 2,
        label: seasonTitle(cur.seasonName) + (cur.isGauntlet ? ' G' : ''),
      });
    }
  }

  const solidSegments: string[] = [];
  const resetSegments: { d: string; idx: number }[] = [];
  let currentSolid = `M${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const pt = `${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)}`;
    if (decayBoundarySet.has(i)) {
      solidSegments.push(currentSolid);
      resetSegments.push({
        d: `M${points[i - 1].x.toFixed(1)} ${points[i - 1].y.toFixed(1)} L${pt}`,
        idx: i,
      });
      currentSolid = `M${pt}`;
    } else {
      currentSolid += ` L${pt}`;
    }
  }
  solidSegments.push(currentSolid);

  const hovered = hoverIdx != null ? history[hoverIdx] : null;
  const hoveredPt = hoverIdx != null ? points[hoverIdx] : null;

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Check if hovering near a reset segment
    let hitReset: number | null = null;
    for (const seg of resetSegments) {
      const p1 = points[seg.idx - 1];
      const p2 = points[seg.idx];
      if (mx >= p1.x - 8 && mx <= p2.x + 8) {
        const t = Math.max(0, Math.min(1, (mx - p1.x) / (p2.x - p1.x || 1)));
        const lineY = p1.y + t * (p2.y - p1.y);
        if (Math.abs(my - lineY) < 12) {
          hitReset = seg.idx;
          break;
        }
      }
    }

    if (hitReset != null) {
      setHoverReset(hitReset);
      setHoverIdx(null);
      return;
    }
    setHoverReset(null);

    let closest = 0;
    let closestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(points[i].x - mx);
      if (d < closestDist) {
        closestDist = d;
        closest = i;
      }
    }
    setHoverIdx(closestDist < 30 ? closest : null);
  }

  return (
    <div ref={containerRef}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block', overflow: 'visible' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => { setHoverIdx(null); setHoverReset(null); }}
      >
        {/* Y-axis grid + labels */}
        {yTicks.map((tick) => {
          const y = PADDING.top + plotH - ((tick - yMin) / (yMax - yMin || 1)) * plotH;
          return (
            <g key={tick}>
              <line
                x1={PADDING.left}
                x2={width - PADDING.right}
                y1={y}
                y2={y}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth={1}
              />
              <text
                x={PADDING.left - 6}
                y={y}
                textAnchor="end"
                dominantBaseline="central"
                fill="rgba(255,255,255,0.35)"
                fontSize={9}
                fontFamily="monospace"
              >
                {Math.round(tick)}
              </text>
            </g>
          );
        })}

        {/* Season boundary lines */}
        {seasonBoundaries.map((b, i) => (
          <g key={i}>
            <line
              x1={b.x}
              x2={b.x}
              y1={PADDING.top}
              y2={PADDING.top + plotH}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth={1}
              strokeDasharray="3,3"
            />
            <text
              x={b.x}
              y={PADDING.top + plotH + 14}
              textAnchor="middle"
              fill="rgba(255,255,255,0.35)"
              fontSize={8}
              fontFamily="monospace"
            >
              {b.label}
            </text>
          </g>
        ))}

        {/* Area fill */}
        <path d={areaPath} fill="var(--color-site-accent)" opacity={0.08} />

        {/* Solid line segments (within seasons) */}
        {solidSegments.map((d, i) => (
          <path
            key={`s${i}`}
            d={d}
            fill="none"
            stroke="var(--color-site-accent)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* Dashed reset segments (across season boundaries) */}
        {resetSegments.map((seg, i) => {
          const isActive = hoverReset === seg.idx;
          return (
            <path
              key={`r${i}`}
              d={seg.d}
              fill="none"
              stroke="var(--color-text-secondary)"
              strokeWidth={isActive ? 2.5 : 1.5}
              strokeLinecap="round"
              strokeDasharray="4,3"
              opacity={isActive ? 0.9 : 0.5}
              style={{ cursor: 'default' }}
            />
          );
        })}

        {/* Dots — show all but highlight hovered */}
        {points.map((p, i) => {
          const isHovered = i === hoverIdx;
          const delta = history[i].ratingDelta;
          const dotColor =
            delta > 0
              ? 'var(--color-accent-green-fill)'
              : delta < 0
                ? 'var(--color-accent-red-fg)'
                : 'var(--color-site-accent)';
          return (
            <Link key={i} href={`/matches/${history[i].matchId}`}>
              <circle
                cx={p.x}
                cy={p.y}
                r={isHovered ? HOVER_R : DOT_R}
                fill={isHovered ? dotColor : 'var(--color-bg-primary)'}
                stroke={isHovered ? dotColor : 'var(--color-site-accent)'}
                strokeWidth={isHovered ? 2.5 : 1.5}
                style={{ cursor: 'pointer', transition: 'r 0.1s' }}
              />
            </Link>
          );
        })}

        {/* Hover tooltip */}
        {hovered && hoveredPt && (() => {
          const label = formatLabel(hovered);
          const deltaStr = hovered.ratingDelta > 0
            ? `+${hovered.ratingDelta.toFixed(2)}`
            : hovered.ratingDelta.toFixed(2);
          const tooltipW = 130;
          const tooltipH = 40;
          let tx = hoveredPt.x - tooltipW / 2;
          if (tx < PADDING.left) tx = PADDING.left;
          if (tx + tooltipW > width - PADDING.right) tx = width - PADDING.right - tooltipW;
          const ty = hoveredPt.y - tooltipH - 12;
          return (
            <g style={{ pointerEvents: 'none' }}>
              <rect
                x={tx}
                y={ty}
                width={tooltipW}
                height={tooltipH}
                rx={4}
                fill="var(--color-bg-secondary)"
                stroke="var(--color-border-primary)"
                strokeWidth={1}
              />
              <text
                x={tx + tooltipW / 2}
                y={ty + 14}
                textAnchor="middle"
                fill="var(--color-text-secondary)"
                fontSize={9}
                fontFamily="monospace"
              >
                {label}
              </text>
              <text
                x={tx + tooltipW / 2}
                y={ty + 30}
                textAnchor="middle"
                fill="var(--color-text-primary)"
                fontSize={12}
                fontFamily="var(--font-display)"
                fontWeight={600}
              >
                {hovered.ehogRating.toFixed(2)} ({deltaStr})
              </text>
            </g>
          );
        })()}

        {/* Reset tooltip */}
        {hoverReset != null && (() => {
          const prev = history[hoverReset - 1];
          const next = history[hoverReset];
          const preMatchRating = next.ehogRating - next.ratingDelta;
          const resetDelta = preMatchRating - prev.ehogRating;
          const midPt = {
            x: (points[hoverReset - 1].x + points[hoverReset].x) / 2,
            y: (points[hoverReset - 1].y + points[hoverReset].y) / 2,
          };
          const tooltipW = 130;
          const tooltipH = 40;
          let tx = midPt.x - tooltipW / 2;
          if (tx < PADDING.left) tx = PADDING.left;
          if (tx + tooltipW > width - PADDING.right) tx = width - PADDING.right - tooltipW;
          const ty = midPt.y - tooltipH - 12;
          return (
            <g style={{ pointerEvents: 'none' }}>
              <rect
                x={tx}
                y={ty}
                width={tooltipW}
                height={tooltipH}
                rx={4}
                fill="var(--color-bg-secondary)"
                stroke="var(--color-border-primary)"
                strokeWidth={1}
              />
              <text
                x={tx + tooltipW / 2}
                y={ty + 14}
                textAnchor="middle"
                fill="var(--color-text-secondary)"
                fontSize={9}
                fontFamily="monospace"
              >
                Off-season decay
              </text>
              <text
                x={tx + tooltipW / 2}
                y={ty + 30}
                textAnchor="middle"
                fill="var(--color-accent-red-fg)"
                fontSize={12}
                fontFamily="var(--font-display)"
                fontWeight={600}
              >
                {resetDelta >= 0 ? '+' : ''}{resetDelta.toFixed(2)}
              </text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}
