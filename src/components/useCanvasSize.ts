'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Sizes a (square) canvas to its container, DPR-aware: capped at `maxSide` and ~60% of
 * viewport height, floor 240px, re-running on container resize via `ResizeObserver`.
 * Shared by every canvas that fits itself to a bordered container this way (the 2D
 * Replay, the Map Heatmap, the Player Trails overlay). Calls `onResize(side)` once the
 * canvas's pixel buffer, CSS size, and 2D context DPR scale are already applied, so the
 * caller can rebuild whatever depends on size (a `Projector`, a redraw) — `onResize`
 * should be `useCallback`-wrapped by the caller so this hook doesn't re-run every render.
 */
export function useCanvasSize(
  containerRef: RefObject<HTMLElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  maxSide: number,
  onResize: (side: number) => void,
): void {
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const resize = () => {
      const maxByHeight = Math.round((window.innerHeight || 800) * 0.6);
      const side = Math.max(240, Math.min(container.clientWidth, maxSide, maxByHeight));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(side * dpr);
      canvas.height = Math.round(side * dpr);
      canvas.style.width = `${side}px`;
      canvas.style.height = `${side}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
      }
      onResize(side);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [containerRef, canvasRef, maxSide, onResize]);
}
