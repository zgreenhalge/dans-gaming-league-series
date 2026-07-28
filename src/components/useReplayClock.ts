'use client';

import { useEffect } from 'react';
import type { MutableRefObject } from 'react';

/**
 * Drives a RAF loop that advances `tickRef` forward at `tickRate * speed` ticks/sec,
 * clamped to `max`, calling `draw()` every frame — whether playing or not, so a paused
 * scrub still repaints — and `onEnd()` once the clock reaches `max` while playing. The
 * shared "advance a tick ref via requestAnimationFrame" primitive behind every replay
 * player (`ReplayPlayer`, `PlayerRoundOverlay`), so the tick-advance math can't drift
 * between them. `max: null` skips the loop entirely (e.g. no payload loaded yet).
 */
export function useReplayClock({
  tickRef,
  playing,
  speed,
  tickRate,
  max,
  draw,
  onEnd,
}: {
  tickRef: MutableRefObject<number>;
  playing: boolean;
  speed: number;
  tickRate: number;
  max: number | null;
  draw: () => void;
  onEnd: () => void;
}) {
  useEffect(() => {
    if (max === null) return;
    let raf = 0;
    let last: number | null = null;
    const step = (ts: number) => {
      if (last !== null) {
        tickRef.current = Math.min(max, tickRef.current + ((ts - last) / 1000) * tickRate * speed);
      }
      last = ts;
      draw();
      if (tickRef.current >= max) {
        onEnd();
        return;
      }
      raf = requestAnimationFrame(step);
    };
    if (playing) raf = requestAnimationFrame(step);
    else draw();
    return () => cancelAnimationFrame(raf);
  }, [tickRef, playing, speed, tickRate, max, draw, onEnd]);
}
