'use client';

import { useRef, useState, useEffect } from 'react';
import { GRADE_TIERS, ehogColorFor } from './EhogBadge';

const EHOG_MIN = 10;
const EHOG_MAX = 100;
const RANGE = EHOG_MAX - EHOG_MIN;
const DOT_R = 5;
const HOVER_R = 7;
const BAR_H = 24;
const DOT_AREA_H = 20;

interface Segment {
  min: number;
  max: number;
  color: string;
  pct: number;
}

function buildSegments(): Segment[] {
  const sorted = [...GRADE_TIERS].sort((a, b) => a.min - b.min);
  return sorted.map((tier, i) => {
    const min = Math.max(tier.min, EHOG_MIN);
    const max = i < sorted.length - 1 ? sorted[i + 1].min : EHOG_MAX;
    return {
      min,
      max,
      color: tier.color,
      pct: ((max - min) / RANGE) * 100,
    };
  });
}

interface PlayerDot {
  id: number;
  name: string;
  rating: number;
}

export default function EhogTierBar({ players }: { players?: PlayerDot[] }) {
  const segments = buildSegments();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerW(entry.contentRect.width);
    });
    observer.observe(node);
    setContainerW(node.clientWidth);
    return () => observer.disconnect();
  }, []);

  const dots = (players ?? []).map((p) => ({
    ...p,
    x: ((Math.max(EHOG_MIN, Math.min(EHOG_MAX, p.rating)) - EHOG_MIN) / RANGE) * containerW,
  }));

  const hovered = hoveredId != null ? dots.find((d) => d.id === hoveredId) : null;
  const totalH = players && players.length > 0 ? BAR_H + DOT_AREA_H : BAR_H;

  return (
    <div ref={containerRef} className="w-full relative" style={{ height: totalH }}>
      <div className="flex overflow-hidden absolute top-0 left-0 right-0" style={{ height: BAR_H, borderRadius: '2px' }}>
        {segments.map((seg) => (
          <div
            key={seg.min}
            className="flex items-center justify-center overflow-hidden"
            style={{
              width: `${seg.pct}%`,
              backgroundColor: seg.color,
              opacity: 0.85,
            }}
          >
            {seg.max - seg.min > 1 && (
              <span className="text-[9px] font-mono font-semibold leading-none" style={{ color: 'rgba(0,0,0,0.6)' }}>
                {seg.min}–{seg.max}
              </span>
            )}
          </div>
        ))}
      </div>

      {dots.length > 0 && containerW > 0 && (
        <svg
          className="absolute left-0"
          width={containerW}
          height={totalH}
          style={{ overflow: 'visible', pointerEvents: 'none' }}
        >
          {dots.map((dot) => {
            const isHovered = dot.id === hoveredId;
            const color = ehogColorFor(dot.rating);
            return (
              <circle
                key={dot.id}
                cx={dot.x}
                cy={BAR_H + DOT_AREA_H / 2}
                r={isHovered ? HOVER_R : DOT_R}
                fill={isHovered ? color : 'var(--color-bg-primary)'}
                stroke={color}
                strokeWidth={2}
                style={{ cursor: 'pointer', pointerEvents: 'auto', transition: 'r 0.1s' }}
                onMouseEnter={() => setHoveredId(dot.id)}
                onMouseLeave={() => setHoveredId(null)}
              />
            );
          })}

          {dots.map((dot) => (
            <line
              key={`tick-${dot.id}`}
              x1={dot.x}
              x2={dot.x}
              y1={BAR_H}
              y2={BAR_H + DOT_AREA_H / 2 - DOT_R - 1}
              stroke={ehogColorFor(dot.rating)}
              strokeWidth={1.5}
              opacity={dot.id === hoveredId ? 1 : 0.5}
            />
          ))}

          {hovered && (() => {
            const tooltipW = 100;
            const tooltipH = 34;
            let tx = hovered.x - tooltipW / 2;
            if (tx < 0) tx = 0;
            if (tx + tooltipW > containerW) tx = containerW - tooltipW;
            const ty = BAR_H + DOT_AREA_H / 2 - HOVER_R - tooltipH - 4;
            return (
              <g style={{ pointerEvents: 'none' }}>
                <rect
                  x={tx}
                  y={ty}
                  width={tooltipW}
                  height={tooltipH}
                  rx={3}
                  fill="var(--color-bg-secondary)"
                  stroke="var(--color-border-primary)"
                  strokeWidth={1}
                />
                <text
                  x={tx + tooltipW / 2}
                  y={ty + 14}
                  textAnchor="middle"
                  fill="var(--color-text-primary)"
                  fontSize={12}
                  fontFamily="var(--font-display)"
                  fontWeight={600}
                >
                  {hovered.name}
                </text>
                <text
                  x={tx + tooltipW / 2}
                  y={ty + 26}
                  textAnchor="middle"
                  fill={ehogColorFor(hovered.rating)}
                  fontSize={12}
                  fontFamily="var(--font-display)"
                  fontWeight={600}
                >
                  {hovered.rating.toFixed(2)}
                </text>
              </g>
            );
          })()}
        </svg>
      )}
    </div>
  );
}
