'use client';
import { useState } from 'react';

export function FeatureMatchIcon() {
  return (
    <span className="relative group">
      <span>
        ⭐
      </span>
      <span
        className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-max px-2 py-1 text-sm
                   text-[var(--color-text-primary)] bg-[var(--color-bg-primary)] rounded shadow-lg
                   opacity-0 group-hover:opacity-100"
      >
        Featured Match
      </span>
    </span>
  );
}

export function FeatureMatchBanner() {
  const [active, setActive] = useState(false);

  return (
    <div
      className={`feature-banner${active ? ' feature-banner-active' : ''} relative overflow-hidden rounded font-semibold text-center mb-6 px-4 py-2 text-white select-none`}
      onMouseEnter={() => setActive(true)}
      onAnimationEnd={(e) => {
        if (e.animationName === 'feature-gradient-pan') setActive(false);
      }}
    >
      <div className={`feature-holo${active ? ' feature-holo-active' : ''}`} />
      ★ MATCH OF THE WEEK ★
    </div>
  );
}
