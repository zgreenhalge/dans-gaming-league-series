'use client';

import { GRADE_TIERS } from './EhogBadge';

const EHOG_MIN = 10;
const EHOG_MAX = 100;
const RANGE = EHOG_MAX - EHOG_MIN;

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

export default function EhogTierBar() {
  const segments = buildSegments();

  return (
    <div className="w-full flex h-[24px] overflow-hidden" style={{ borderRadius: '2px' }}>
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
  );
}
