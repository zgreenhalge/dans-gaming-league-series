'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import {
  autoFitProjector,
  boundsOfPoints,
  calibratedProjector,
  countDistinctMatches,
  drawRadarBackground,
  type Projector,
} from '@/lib/replay/project';
import { traceStateAt, maxDurationTicks, type PlayerTrace } from '@/lib/replay/aggregate';
import { readTheme } from './replayTheme';
import { useMapRadar } from './useMapRadar';
import { useCanvasSize } from './useCanvasSize';

const SPEEDS = [0.5, 1, 2, 4];
const MAX_SIDE = 520;
/** Dot radius in canvas px — alive full color, dead dimmed (mirrors ReplayPlayer's convention). */
const DOT_RADIUS = 4;
const DEAD_ALPHA = 0.3;
const ALIVE_ALPHA = 0.85;

/**
 * Plays every round in `traces` at once, each round's clock zeroed to its own start —
 * many translucent ghosts of the same player moving simultaneously, so common
 * paths/timings read as brighter density (issue #128). Traces must all share one map
 * (positions are world coords projected onto that map's radar/auto-fit bounds); the
 * caller is responsible for only passing traces from one map at a time.
 */
export default function PlayerRoundOverlay({
  slug,
  traces,
  tickRate,
  playerName,
}: {
  slug: string;
  traces: PlayerTrace[];
  tickRate: number;
  playerName: string;
}) {
  const { calibration, radarImage } = useMapRadar(slug);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [side, setSide] = useState<'CT' | 'T' | 'all'>('all');

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const tickRef = useRef(0);
  const projectorRef = useRef<Projector | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });

  const bounds = useMemo(() => boundsOfPoints(traces.flatMap((t) => t.frames)), [traces]);
  const duration = useMemo(() => maxDurationTicks(traces), [traces]);
  const visible = useMemo(
    () => (side === 'all' ? traces : traces.filter((t) => t.side === side)),
    [traces, side],
  );
  const gameCount = useMemo(() => countDistinctMatches(visible), [visible]);

  // Restart the shared clock whenever the underlying trace set changes (a different
  // player/map picked upstream) rather than carrying over a stale scrub position.
  // `tickRef` is a ref, not React state, so this doesn't need to guard against
  // re-render loops the way a `setState` call in an effect would.
  //
  // Must run before the visible-sync effect below: `visible` is derived from `traces`,
  // so a `traces` change fires both effects in the same commit — React runs effects in
  // declaration order, so this reset lands before that effect's repaint reads
  // `tickRef.current`, and the repaint shows tick 0 rather than one frame at the
  // previous (now-stale) scrub position.
  useEffect(() => {
    tickRef.current = 0;
  }, [traces]);

  // Side colors read from CSS custom properties, refreshed each canvas resize (see
  // `onResize` below) so a live light/dark toggle is picked up the same way
  // `ReplayPlayer` incidentally does, instead of only once on mount.
  const colorsRef = useRef({ CT: '#5b9bd5', T: '#d5a04b', neutral: '#e6e6e6' });

  // Each visible trace's color resolved once (not per animation frame — issue #224).
  // The source of truth for which traces `draw()` shows; rebuilt from `visible`
  // whenever the trace set changes (below), and re-colored in place from its own
  // tracked traces on a resize/theme refresh — no separate ref of `visible` needed.
  const coloredRef = useRef<{ trace: PlayerTrace; color: string }[]>([]);
  const recolor = useCallback(() => {
    const colors = colorsRef.current;
    coloredRef.current = coloredRef.current.map(({ trace }) => ({ trace, color: colors[trace.side ?? 'neutral'] }));
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const projector = projectorRef.current;
    if (!ctx || !projector) return;
    const { w, h } = sizeRef.current;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, 0, w, h);
    if (calibration && radarImage.current) {
      drawRadarBackground(ctx, projector, radarImage.current, calibration);
    }

    ctx.globalCompositeOperation = 'lighter';
    for (const { trace, color } of coloredRef.current) {
      const state = traceStateAt(trace, tickRef.current);
      if (!state) continue;
      const c = projector.project(state);
      ctx.globalAlpha = state.alive ? ALIVE_ALPHA : DEAD_ALPHA;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(c.x, c.y, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (scrubRef.current) scrubRef.current.value = String(tickRef.current);
  }, [calibration, radarImage]);

  // Rebuild the tracked/colored trace set whenever the visible set actually changes —
  // e.g. the side filter — not on every play/pause toggle.
  useEffect(() => {
    const colors = colorsRef.current;
    coloredRef.current = visible.map((trace) => ({ trace, color: colors[trace.side ?? 'neutral'] }));
  }, [visible]);

  // Repaint (without resizing) whenever the visible trace set changes, while the clock
  // is stopped; a running clock already repaints every frame.
  useEffect(() => {
    if (!playing) draw();
  }, [visible, playing, draw]);

  // --- size canvas to its container (DPR-aware) + (re)build the projector ---
  const onResize = useCallback(
    (sidePx: number) => {
      sizeRef.current = { w: sidePx, h: sidePx };
      if (calibration) projectorRef.current = calibratedProjector(calibration, sidePx, sidePx);
      else if (bounds) projectorRef.current = autoFitProjector(bounds, sidePx, sidePx);
      const container = containerRef.current;
      if (container) {
        const theme = readTheme(container);
        colorsRef.current = { CT: theme.ct, T: theme.t, neutral: theme.text };
      }
      recolor();
      draw();
    },
    [calibration, bounds, recolor, draw],
  );
  useCanvasSize(containerRef, canvasRef, MAX_SIDE, onResize);

  // --- playback clock — a shared clock all traces play against, each stopping once
  //     past its own round's duration (handled by traceStateAt returning null) ---
  // `tickRate` is clamped away from <= 0 (a corrupt/missing value from the source
  // payload) so the clock always advances — a non-advancing clock would never reach
  // `duration` and Play would look permanently stuck.
  const safeTickRate = tickRate > 0 ? tickRate : 64;
  useEffect(() => {
    let raf = 0;
    let last: number | null = null;
    const step = (ts: number) => {
      if (last !== null) {
        tickRef.current = Math.min(duration, tickRef.current + ((ts - last) / 1000) * safeTickRate * speed);
      }
      last = ts;
      draw();
      if (tickRef.current >= duration) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(step);
    };
    if (playing) raf = requestAnimationFrame(step);
    else draw();
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, duration, safeTickRate, draw]);

  if (traces.length === 0) {
    return (
      <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
        No rounds with position data for {playerName} on this map.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-1 text-[12px]">
        {(['all', 'CT', 'T'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            className={`border px-1.5 py-0.5 font-mono ${
              side === s
                ? 'border-[var(--color-text-primary)] text-[var(--color-text-primary)]'
                : 'border-[var(--color-border-primary)] text-[var(--color-text-secondary)]'
            }`}
          >
            {s === 'all' ? 'Both' : s}
          </button>
        ))}
      </div>

      <canvas ref={canvasRef} className="block mx-auto border border-[var(--color-border-primary)]" />

      <input
        ref={scrubRef}
        type="range"
        min={0}
        max={duration}
        step={1}
        defaultValue={0}
        onInput={(e) => {
          tickRef.current = Number(e.currentTarget.value);
          if (!playing) draw();
        }}
        className="w-full accent-[var(--color-text-primary)]"
        aria-label="Scrub aggregate replay"
      />

      <div className="flex items-center gap-3 text-[12px]">
        <button
          type="button"
          onClick={() => {
            if (tickRef.current >= duration) tickRef.current = 0;
            setPlaying((p) => !p);
          }}
          className="lift-card border border-[var(--color-border-primary)] p-1.5"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <div className="ml-auto flex items-center gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              className={`border px-1.5 py-0.5 font-mono ${
                speed === s
                  ? 'border-[var(--color-text-primary)] text-[var(--color-text-primary)]'
                  : 'border-[var(--color-border-primary)] text-[var(--color-text-secondary)]'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
      <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">
        {gameCount} game{gameCount === 1 ? '' : 's'} · {visible.length} round{visible.length === 1 ? '' : 's'} overlaid
        {!calibration && ' · auto-fit (map not calibrated)'}
      </div>
    </div>
  );
}
