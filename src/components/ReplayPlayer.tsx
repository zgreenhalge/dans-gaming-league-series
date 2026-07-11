'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReplayPayload, ReplayPlayerMeta } from '@/lib/replay/types';
import type { Faction } from '@/lib/types';
import { mapSlug } from '@/lib/maps';
import { projectorFor, type Projector } from '@/lib/replay/project';
import { viewStateAt, roundTickRange } from '@/lib/replay/playback';
import { drawScene, type Ctx2D, type ReplayTheme, type BannerInfo } from '@/lib/replay/draw';
import { useMapRadar } from './useMapRadar';

const SPEEDS = [0.5, 1, 2, 4];

/** Cap the square play-field so it never dominates a wide match page. */
const MAX_SIDE = 520;

/** Read a CSS custom property off an element, falling back to a literal. */
function cssVar(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

function readTheme(el: Element): ReplayTheme {
  return {
    bg: cssVar(el, '--color-bg-secondary', '#0b0e14'),
    grid: cssVar(el, '--color-border-tertiary', '#1c2230'),
    ct: cssVar(el, '--color-ct', '#5b9bd5'),
    t: cssVar(el, '--color-t', '#d5a04b'),
    text: cssVar(el, '--color-text-primary', '#e6e6e6'),
    textDim: cssVar(el, '--color-text-secondary', '#8a8f98'),
    bomb: '#f59e0b',
    tracer: '#e5484d',
    smoke: '#9aa0ab',
    fire: '#e5642d',
    flash: '#e8e6c8',
    he: '#d8d24b',
    decoy: '#6b8fd5',
  };
}

/** Cumulative score going into `roundIdx`, plotted by the round's current sides. */
function bannerFor(payload: ReplayPayload, roundIdx: number): BannerInfo {
  const round = payload.rounds[roundIdx];
  const ctFaction: Faction = round.sideByFaction.SHIRTS === 'CT' ? 'SHIRTS' : 'SKINS';
  const tFaction: Faction = ctFaction === 'SHIRTS' ? 'SKINS' : 'SHIRTS';
  let ctScore = 0;
  let tScore = 0;
  for (let i = 0; i < roundIdx; i++) {
    const end = payload.rounds[i].events.find((e) => e.type === 'round_end');
    if (end && end.type === 'round_end' && end.winnerFaction) {
      if (end.winnerFaction === ctFaction) ctScore++;
      else tScore++;
    }
  }
  return {
    round: round.round,
    totalRounds: payload.rounds.length,
    isKnifeRound: round.isKnifeRound,
    ctFaction,
    tFaction,
    ctScore,
    tScore,
  };
}

export default function ReplayPlayer({
  matchId,
  jump,
}: {
  matchId: number;
  /** External jump request: 1-based round number + a nonce that changes per click. */
  jump?: { round: number; n: number } | null;
}) {
  const [payload, setPayload] = useState<ReplayPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roundIdx, setRoundIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  // Rendered pixel width of the (square) play-field, so the scrubber/controls below
  // can be constrained to match it instead of the full container width.
  const [boardWidth, setBoardWidth] = useState(0);
  // The map's radar calibration + image (shared with the heatmap via useMapRadar).
  // Null calibration = uncalibrated map (auto-fit grid).
  const { calibration, radarImage } = useMapRadar(payload ? mapSlug(payload.map) : null);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const projectorRef = useRef<Projector | null>(null);
  const ctxRef = useRef<Ctx2D | null>(null);
  const themeRef = useRef<ReplayTheme | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const tickRef = useRef(0);
  // Last-applied jump nonce, kept in state so the "adjust state when a prop changes"
  // pattern can run during render (refs can't be read/written there).
  const [lastJumpN, setLastJumpN] = useState(0);

  // Roster lookup + score banner are constant within a round — build them once per
  // round change, not every animation frame.
  const metaById = useMemo(
    () => new Map<number, ReplayPlayerMeta>((payload?.players ?? []).map((p) => [p.id, p])),
    [payload],
  );
  const banner = useMemo(
    () => (payload ? bannerFor(payload, roundIdx) : null),
    [payload, roundIdx],
  );

  // --- lazy payload fetch (only mounts when the Replay sub-tab is open) ---
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/matches/${matchId}/replay/payload`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load replay (${res.status})`);
        return (await res.json()) as ReplayPayload;
      })
      .then((p) => {
        if (cancelled) return;
        setPayload(p);
        tickRef.current = p.rounds.length ? roundTickRange(p.rounds[0]).start : 0;
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  // --- draw one frame at the current tick ---
  const draw = useCallback(() => {
    const proj = projectorRef.current;
    const ctx = ctxRef.current;
    const theme = themeRef.current;
    if (!ctx || !proj || !theme || !payload || !banner) return;
    const round = payload.rounds[roundIdx];
    if (!round) return;
    const { w, h } = sizeRef.current;
    const state = viewStateAt(round, tickRef.current, payload.tickRate);
    const radar =
      calibration && radarImage.current
        ? { image: radarImage.current, calibration }
        : null;
    drawScene({
      ctx,
      width: w,
      height: h,
      projector: proj,
      state,
      round,
      metaById,
      tickRate: payload.tickRate,
      theme,
      banner,
      radar,
    });
    // Reflect playback position on the (uncontrolled) scrubber without re-rendering.
    if (scrubRef.current) scrubRef.current.value = String(tickRef.current);
  }, [payload, roundIdx, calibration, radarImage, metaById, banner]);

  // --- size canvas to its container (DPR-aware) + (re)build the projector ---
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || !payload) return;
    const resize = () => {
      // Square play-field, but capped so it doesn't dominate the page on wide
      // viewports — fit within the container width and ~60% of the viewport height.
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
        // Cache the context so the per-frame draw loop doesn't re-fetch it.
        ctxRef.current = ctx as unknown as Ctx2D;
      }
      sizeRef.current = { w: side, h: side };
      setBoardWidth(side);
      themeRef.current = readTheme(container);
      // Calibrated radar projection when the map has one, else auto-fit over the
      // whole payload's bounds.
      projectorRef.current = projectorFor(payload, side, side, calibration);
      draw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [payload, draw, calibration]);

  // --- reset to round start whenever the round changes ---
  useEffect(() => {
    if (!payload?.rounds[roundIdx]) return;
    tickRef.current = roundTickRange(payload.rounds[roundIdx]).start;
  }, [payload, roundIdx]);


  // --- playback clock ---
  useEffect(() => {
    if (!payload?.rounds[roundIdx]) return;
    const round = payload.rounds[roundIdx];
    const range = roundTickRange(round);
    let raf = 0;
    let last: number | null = null;
    const step = (ts: number) => {
      if (last !== null) {
        tickRef.current = Math.min(
          range.end,
          tickRef.current + ((ts - last) / 1000) * payload.tickRate * speed,
        );
      }
      last = ts;
      draw();
      if (tickRef.current >= range.end) {
        // Advance to the next round, or stop at the end of the match.
        if (roundIdx < payload.rounds.length - 1) setRoundIdx(roundIdx + 1);
        else setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(step);
    };
    if (playing) raf = requestAnimationFrame(step);
    else draw();
    return () => cancelAnimationFrame(raf);
  }, [payload, roundIdx, playing, speed, draw]);

  // Apply an external jump request during render (the React-blessed "adjust state when
  // a prop changes" pattern — guarded by the nonce so it can't loop).
  if (jump && payload && jump.n !== lastJumpN) {
    setLastJumpN(jump.n);
    const idx = payload.rounds.findIndex((r) => r.round === jump.round);
    if (idx >= 0) {
      setRoundIdx(idx);
      setPlaying(true);
    }
  }

  if (error) {
    return (
      <div className="border border-[var(--color-border-primary)] px-5 py-10 text-center font-mono text-[12px] text-[var(--color-accent-red-fg)]">
        {error}
      </div>
    );
  }
  if (!payload) {
    return (
      <div className="border border-[var(--color-border-primary)] px-5 py-10 text-center font-mono text-[12px] text-[var(--color-text-secondary)]">
        Loading replay…
      </div>
    );
  }
  if (payload.rounds.length === 0) {
    return (
      <div className="border border-[var(--color-border-primary)] px-5 py-10 text-center font-mono text-[12px] text-[var(--color-text-secondary)]">
        This replay has no rounds to play.
      </div>
    );
  }

  const round = payload.rounds[roundIdx];
  const range = roundTickRange(round);

  return (
    <div ref={containerRef} className="w-full">
      {/* Centered board: the scrubber + controls are constrained to the canvas width. */}
      <div className="mx-auto space-y-3" style={boardWidth ? { width: boardWidth } : undefined}>
        <canvas ref={canvasRef} className="block border border-[var(--color-border-primary)]" />

        {/* Scrubber */}
        <input
          ref={scrubRef}
          type="range"
          min={range.start}
          max={range.end}
          step={1}
          defaultValue={range.start}
          onInput={(e) => {
            tickRef.current = Number(e.currentTarget.value);
            if (!playing) draw();
          }}
          className="w-full accent-[var(--color-text-primary)]"
          aria-label="Scrub replay"
        />

        {/* Controls */}
        <div className="flex items-center gap-3 text-[12px]">
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className="lift-card border border-[var(--color-border-primary)] p-1.5"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setRoundIdx((i) => Math.max(0, i - 1))}
              disabled={roundIdx === 0}
              className="border border-[var(--color-border-primary)] p-1 disabled:opacity-40"
              aria-label="Previous round"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="font-mono tabular-nums text-[var(--color-text-secondary)] px-1">
              {round.isKnifeRound ? 'Knife Round' : `Round ${round.round} / ${payload.rounds.length}`}
            </span>
            <button
              type="button"
              onClick={() => setRoundIdx((i) => Math.min(payload.rounds.length - 1, i + 1))}
              disabled={roundIdx === payload.rounds.length - 1}
              className="border border-[var(--color-border-primary)] p-1 disabled:opacity-40"
              aria-label="Next round"
            >
              <ChevronRight size={14} />
            </button>
          </div>

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
      </div>
    </div>
  );
}
