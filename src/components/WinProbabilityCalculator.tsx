'use client';

// For Nerds calculator (#60): a genuine closed-form EHOG tool, unlike the rating itself (a
// chronological recompute over match history, not a pluggable formula). Given two hypothetical
// teams' EHOG display ratings, this wraps the same `predictWinProbability()` (`src/lib/ehog.ts`,
// client-bundle-safe) the match page uses for its own pre-match win probability. Sigma for each
// hypothetical player is fixed at `SIGMA_DEFAULT` (a new player's starting uncertainty) since a
// display rating alone doesn't carry the real player's actual sigma.

import { useState } from 'react';
import { SIGMA_DEFAULT, DEFAULT_EHOG, fromEhog, predictWinProbability, type PlayerRating } from '@/lib/ehog';

const inputCls =
  'w-full font-mono text-[13px] px-2 py-1.5 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] rounded focus:outline-none focus:border-[var(--color-text-secondary)]';
const labelCls = 'font-mono text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]';

function RatingField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={labelCls}>{label}</span>
      <input
        type="number"
        min={10}
        max={100}
        value={value}
        onChange={(e) => onChange(Math.min(100, Math.max(10, Number(e.target.value) || 10)))}
        className={inputCls}
      />
    </label>
  );
}

function toTeam(ratings: number[]): PlayerRating[] {
  return ratings.map((ehogRating, i) => ({
    playerId: i,
    mu: fromEhog(ehogRating, SIGMA_DEFAULT),
    sigma: SIGMA_DEFAULT,
    ehogRating,
  }));
}

export function WinProbabilityCalculator() {
  const start = Math.round(DEFAULT_EHOG);
  const [a1, setA1] = useState(start);
  const [a2, setA2] = useState(start);
  const [b1, setB1] = useState(start);
  const [b2, setB2] = useState(start);

  const pA = predictWinProbability(toTeam([a1, a2]), toTeam([b1, b2]));

  return (
    <div className="border border-[var(--color-border-tertiary)] rounded p-4">
      <div className="font-display text-[15px] font-semibold mb-3">Win probability calculator</div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className={`${labelCls} mb-2`}>Team A</div>
          <div className="grid grid-cols-2 gap-2">
            <RatingField label="Player 1 EHOG" value={a1} onChange={setA1} />
            <RatingField label="Player 2 EHOG" value={a2} onChange={setA2} />
          </div>
        </div>
        <div>
          <div className={`${labelCls} mb-2`}>Team B</div>
          <div className="grid grid-cols-2 gap-2">
            <RatingField label="Player 1 EHOG" value={b1} onChange={setB1} />
            <RatingField label="Player 2 EHOG" value={b2} onChange={setB2} />
          </div>
        </div>
      </div>
      <div className="mt-4 font-mono text-[13px]">
        <span className={labelCls}>Team A win probability</span>
        <div className="text-[24px] font-semibold text-[var(--color-text-primary)]">
          {Math.round(pA * 100)}%
        </div>
      </div>
    </div>
  );
}
