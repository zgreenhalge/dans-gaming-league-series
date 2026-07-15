'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import { autoFitProjector, calibratedProjector, type Projector, type Bounds } from '@/lib/replay/project';
import { traceStateAt, maxDurationTicks, type PlayerTrace } from '@/lib/replay/aggregate';
import { useMapRadar } from './useMapRadar';

const SPEEDS = [0.5, 1, 2, 4];
const MAX_SIDE = 520;
/** Dot radius in canvas px — alive full color, dead dimmed (mirrors ReplayPlayer's convention). */
const DOT_RADIUS = 4;
const DEAD_ALPHA = 0.3;
const ALIVE_ALPHA = 0.85;

function boundsOf(traces: PlayerTrace[]): Bounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const trace of traces) {
    for (const f of trace.frames) {
      if (f.x < minX) minX = f.x;
      if (f.y < minY) minY = f.y;
      if (f.x > maxX) maxX = f.x;
      if (f.y > maxY) maxY = f.y;
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

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
  const activeCountRef = useRef<HTMLSpanElement>(null);
  const tickRef = useRef(0);
  const projectorRef = useRef<Projector | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });

  const bounds = useMemo(() => boundsOf(traces), [traces]);
  const duration = useMemo(() => maxDurationTicks(traces), [traces]);
  const visible = useMemo(
    () => (side === 'all' ? traces : traces.filter((t) => t.side === side)),
    [traces, side],
  );
  // Read by `draw()` instead of closing over `visible` directly, so toggling the side
  // filter doesn't change `draw`'s identity and doesn't re-trigger the canvas-sizing
  // effect below (which rebuilds the projector) — only an actual resize should do that.
  const visibleRef = useRef(visible);

  // Restart the shared clock whenever the underlying trace set changes (a different
  // player/map picked upstream) rather than carrying over a stale scrub position.
  // `tickRef` is a ref, not React state, so this doesn't need to guard against
  // re-render loops the way a `setState` call in an effect would.
  useEffect(() => {
    tickRef.current = 0;
  }, [traces]);

  // Side colors are read from CSS custom properties once per mount (canvas fillStyle
  // can't take `var(...)` directly), matching the team-color convention used elsewhere.
  const colorsRef = useRef({ CT: '#5b9bd5', T: '#d5a04b', neutral: '#e6e6e6' });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const colors = colorsRef.current;
    colors.CT = style.getPropertyValue('--color-ct').trim() || colors.CT;
    colors.T = style.getPropertyValue('--color-t').trim() || colors.T;
    colors.neutral = style.getPropertyValue('--color-text-primary').trim() || colors.neutral;
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
      const tl = projector.project({ x: calibration.posX, y: calibration.posY });
      const br = projector.project({
        x: calibration.posX + calibration.imageWidth * calibration.scale,
        y: calibration.posY - calibration.imageHeight * calibration.scale,
      });
      ctx.globalAlpha = 0.85;
      ctx.drawImage(radarImage.current, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      ctx.globalAlpha = 1;
    }

    const shown = visibleRef.current;
    const colors = colorsRef.current;
    ctx.globalCompositeOperation = 'lighter';
    let active = 0;
    for (const trace of shown) {
      const state = traceStateAt(trace, tickRef.current);
      if (!state) continue;
      active++;
      const c = projector.project(state);
      ctx.globalAlpha = state.alive ? ALIVE_ALPHA : DEAD_ALPHA;
      ctx.fillStyle = colors[trace.side ?? 'neutral'];
      ctx.beginPath();
      ctx.arc(c.x, c.y, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (scrubRef.current) scrubRef.current.value = String(tickRef.current);
    if (activeCountRef.current) activeCountRef.current.textContent = `${active} / ${shown.length} rounds`;
  }, [calibration, radarImage]);

  // Repaint (without resizing) whenever the visible trace set changes — e.g. the side
  // filter — while the clock is stopped; a running clock already repaints every frame.
  useEffect(() => {
    visibleRef.current = visible;
    if (!playing) draw();
  }, [visible, playing, draw]);

  // --- size canvas to its container (DPR-aware) + (re)build the projector ---
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const resize = () => {
      const maxByHeight = Math.round((window.innerHeight || 800) * 0.6);
      const side = Math.max(240, Math.min(container.clientWidth, MAX_SIDE, maxByHeight));
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
      sizeRef.current = { w: side, h: side };
      if (calibration) projectorRef.current = calibratedProjector(calibration, side, side);
      else if (bounds) projectorRef.current = autoFitProjector(bounds, side, side);
      draw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [calibration, bounds, draw]);

  // --- playback clock — a shared clock all traces play against, each stopping once
  //     past its own round's duration (handled by traceStateAt returning null) ---
  useEffect(() => {
    let raf = 0;
    let last: number | null = null;
    const step = (ts: number) => {
      if (last !== null) {
        tickRef.current = Math.min(duration, tickRef.current + ((ts - last) / 1000) * tickRate * speed);
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
  }, [playing, speed, duration, tickRate, draw]);

  if (traces.length === 0) {
    return (
      <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
        No rounds with position data for {playerName} on this map.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="font-mono text-[var(--color-text-secondary)]">
          {playerName} — <span ref={activeCountRef}>0 / {visible.length} rounds</span>
        </span>
        <div className="ml-auto flex items-center gap-1">
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
        {visible.length} round{visible.length === 1 ? '' : 's'} overlaid
        {!calibration && ' · auto-fit (map not calibrated)'}
      </div>
    </div>
  );
}
