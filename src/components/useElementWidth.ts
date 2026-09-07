'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Tracks a container element's rendered width via `ResizeObserver`, re-measuring on mount and on
 * resize — the responsive-chart-width pattern shared by every hand-rolled SVG chart
 * (`EhogTimeline`, `EhogTierBar`, `RoundEconomyChart`). `minWidth` floors the reported value (so a
 * chart never renders unreadably narrow mid-layout-shift); `initialWidth` (defaulting to
 * `minWidth`) is the value used for the very first render, before the observer's first
 * measurement lands.
 */
export function useElementWidth(minWidth: number, initialWidth: number = minWidth): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initialWidth);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(Math.max(minWidth, entry.contentRect.width));
    });
    observer.observe(node);
    setWidth(Math.max(minWidth, node.clientWidth));
    return () => observer.disconnect();
  }, [minWidth]);

  return [ref, width];
}
