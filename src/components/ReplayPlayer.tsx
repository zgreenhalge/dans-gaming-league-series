'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, ChevronLeft, ChevronRight, Rewind, Pencil, Square, Eraser, Trash2, Undo2 } from 'lucide-react';
import type { ReplayPayload, ReplayPlayerMeta } from '@/lib/replay/types';
import type { Faction } from '@/lib/types';
import { mapSlug } from '@/lib/maps';
import { projectorFor, type Projector } from '@/lib/replay/project';
import { viewStateAt, roundTickRange, grenadeEffectRadius } from '@/lib/replay/playback';
import { drawScene, type Ctx2D, type ReplayTheme, type BannerInfo } from '@/lib/replay/draw';
import { useMapRadar } from './useMapRadar';

const SPEEDS = [0.5, 1, 2, 4];

/** How far the rewind button steps back. */
const REWIND_SECONDS = 10;

/** Cap the square play-field so it never dominates a wide match page. */
export const MAX_SIDE = 520;

// --- Pen tool (local-only annotation overlay; never persisted) ---

const PEN_COLORS = ['#ef4444', '#f97316', '#22c55e', '#3b82f6', '#ec4899'];
const PEN_LINE_WIDTH = 3;
const STICKER_RING_WIDTH = 2;
const STICKER_FILL_ALPHA = 0.3;
/** Same hex values `readTheme()` uses for the live smoke/fire/HE effect rendering, so
 *  the pen tool's grenade stickers read as the same colors, not a lookalike palette. */
const STICKER_COLORS = { smoke: '#9aa0ab', molotov: '#e5642d', he: '#d8d24b' } as const;
type StickerKind = keyof typeof STICKER_COLORS;
/** Fraction of the board's side a pointer must land within a stroke to erase it. */
const ERASE_TOLERANCE = 0.03;
/** Fraction of the board's side a dragged box's diagonal must reach to be kept. */
const MIN_BOX_DRAG = 0.02;
/** Max stroke history kept for Undo. */
const MAX_UNDO_HISTORY = 50;

type Point = { x: number; y: number };
/** Points/corners are normalized (0–1) against the board's side, so they redraw
 *  correctly at any board size without needing to be re-recorded. Sticker radii are
 *  NOT normalized this way — they're real AoE sizes, so they're re-derived from the
 *  current `Projector` at paint time (see `paintStroke`), staying accurate under
 *  auto-fit vs. calibrated-radar projections and across resizes. */
type PenStroke = { tool: 'pen'; color: string; points: Point[] };
type BoxStroke = { tool: 'box'; color: string; a: Point; b: Point };
type StickerStroke = { tool: StickerKind; center: Point };
type Stroke = PenStroke | BoxStroke | StickerStroke;
type AnnotationTool = 'pen' | 'box' | 'eraser' | StickerKind;

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The 4 edges of a box stroke's rectangle, corners in either order. */
function boxEdges(stroke: BoxStroke): [Point, Point][] {
  const x0 = Math.min(stroke.a.x, stroke.b.x);
  const x1 = Math.max(stroke.a.x, stroke.b.x);
  const y0 = Math.min(stroke.a.y, stroke.b.y);
  const y1 = Math.max(stroke.a.y, stroke.b.y);
  return [
    [{ x: x0, y: y0 }, { x: x1, y: y0 }],
    [{ x: x1, y: y0 }, { x: x1, y: y1 }],
    [{ x: x1, y: y1 }, { x: x0, y: y1 }],
    [{ x: x0, y: y1 }, { x: x0, y: y0 }],
  ];
}

/** A sticker's true AoE radius, normalized against the board's side like everything
 *  else `strokeHit`/`paintStroke` work in — derived from the current `Projector`
 *  rather than stored, so it stays accurate across zoom/resize. */
function stickerRadiusNorm(kind: StickerKind, side: number, projector: Projector | null): number {
  if (!projector || side === 0) return 0;
  return projector.scaleLength(grenadeEffectRadius(kind)) / side;
}

/** Whether an eraser hit at `p` (normalized) touches `stroke`, within `tolerance`. */
function strokeHit(stroke: Stroke, p: Point, tolerance: number, side: number, projector: Projector | null): boolean {
  if (stroke.tool === 'box') {
    return boxEdges(stroke).some(([a, b]) => distToSegment(p, a, b) <= tolerance);
  }
  if (stroke.tool !== 'pen') {
    // Sticker — a filled disc, so anywhere inside (plus a little margin) counts as a hit.
    return Math.hypot(p.x - stroke.center.x, p.y - stroke.center.y) <= stickerRadiusNorm(stroke.tool, side, projector) + tolerance;
  }
  if (stroke.points.length === 1) {
    return Math.hypot(p.x - stroke.points[0].x, p.y - stroke.points[0].y) <= tolerance;
  }
  for (let i = 0; i < stroke.points.length - 1; i++) {
    if (distToSegment(p, stroke.points[i], stroke.points[i + 1]) <= tolerance) return true;
  }
  return false;
}

/** Paints one stroke onto the annotation canvas; `side` de-normalizes its points. */
function paintStroke(ctx: CanvasRenderingContext2D, side: number, stroke: Stroke, projector: Projector | null) {
  if (stroke.tool === 'box') {
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = PEN_LINE_WIDTH;
    const x = Math.min(stroke.a.x, stroke.b.x) * side;
    const y = Math.min(stroke.a.y, stroke.b.y) * side;
    ctx.strokeRect(x, y, Math.abs(stroke.b.x - stroke.a.x) * side, Math.abs(stroke.b.y - stroke.a.y) * side);
    return;
  }
  if (stroke.tool !== 'pen') {
    // Sticker — translucent fill (the AoE) with a crisp ring at the true radius.
    const r = stickerRadiusNorm(stroke.tool, side, projector) * side;
    if (r <= 0) return;
    const cx = stroke.center.x * side;
    const cy = stroke.center.y * side;
    const color = STICKER_COLORS[stroke.tool];
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.globalAlpha = STICKER_FILL_ALPHA;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = STICKER_RING_WIDTH;
    ctx.stroke();
    return;
  }
  if (stroke.points.length < 2) return;
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = PEN_LINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x * side, stroke.points[0].y * side);
  for (const pt of stroke.points.slice(1)) ctx.lineTo(pt.x * side, pt.y * side);
  ctx.stroke();
}

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
    smoke: STICKER_COLORS.smoke,
    fire: STICKER_COLORS.molotov,
    flash: '#e8e6c8',
    he: STICKER_COLORS.he,
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
  onPosition,
}: {
  matchId: number;
  /** External jump request: round number + a nonce that changes per click, plus an
   *  optional tick to land on (defaults to the round's start). */
  jump?: { round: number; n: number; tick?: number } | null;
  /** Fired once per drawn frame with the current round number + tick, so a sibling
   *  component (e.g. a synced events panel) can track playback position without
   *  this player re-rendering on every frame. */
  onPosition?: (round: number, tick: number) => void;
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
  // A round + optional tick requested by the last jump, applied by the effect below
  // once its target round is showing. Kept in state (not a ref) because it's set
  // during render, alongside `roundIdx`/`playing` — see the jump-handling block.
  const [pendingJump, setPendingJump] = useState<{ idx: number; tick?: number } | null>(null);
  // Last-applied jump nonce, kept in state so the "adjust state when a prop changes"
  // pattern can run during render (refs can't be read/written there).
  const [lastJumpN, setLastJumpN] = useState(0);

  // Pen tool: `tool` null means the overlay lets pointer input pass through to the
  // page (no accidental doodles while scrubbing). Committed marks live in `strokesRef`
  // (not React state — like `tickRef`, they're painted imperatively, never diffed).
  const [tool, setTool] = useState<AnnotationTool | null>(null);
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const annotationCanvasRef = useRef<HTMLCanvasElement>(null);
  const annCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const drawingRef = useRef<Stroke | { tool: 'eraser' } | null>(null);
  // Snapshots of `strokesRef.current` taken before each mutation, for Undo. Kept as a
  // ref (not state) like the other annotation data — a click with nothing to undo is
  // just a harmless no-op, so the button doesn't need reactive enabled/disabled state.
  const historyRef = useRef<Stroke[][]>([]);

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
        strokesRef.current = [];
        historyRef.current = [];
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
    onPosition?.(round.round, tickRef.current);
  }, [payload, roundIdx, calibration, radarImage, metaById, banner, onPosition]);

  // --- step the clock back without leaving the current round ---
  const rewind = useCallback(() => {
    if (!payload) return;
    const round = payload.rounds[roundIdx];
    if (!round) return;
    const range = roundTickRange(round);
    tickRef.current = Math.max(range.start, tickRef.current - REWIND_SECONDS * payload.tickRate);
    draw();
  }, [payload, roundIdx, draw]);

  // --- repaint the annotation overlay from `strokesRef` (+ an optional in-progress
  //     preview, e.g. a box still being dragged) — the source of truth is the
  //     stroke list, never the canvas bitmap, so a resize can safely wipe and redraw it ---
  const redrawAnnotations = useCallback((preview?: Stroke) => {
    const ctx = annCtxRef.current;
    const side = sizeRef.current.w;
    if (!ctx) return;
    ctx.clearRect(0, 0, side, side);
    for (const s of strokesRef.current) paintStroke(ctx, side, s, projectorRef.current);
    if (preview) paintStroke(ctx, side, preview, projectorRef.current);
  }, []);

  // Snapshot the current strokes onto the undo stack before a mutation applies.
  const pushHistory = useCallback(() => {
    historyRef.current.push(strokesRef.current);
    if (historyRef.current.length > MAX_UNDO_HISTORY) historyRef.current.shift();
  }, []);

  const clearAnnotations = useCallback(() => {
    if (strokesRef.current.length === 0) return;
    pushHistory();
    strokesRef.current = [];
    drawingRef.current = null;
    redrawAnnotations();
  }, [pushHistory, redrawAnnotations]);

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    strokesRef.current = prev;
    drawingRef.current = null;
    redrawAnnotations();
  }, [redrawAnnotations]);

  // Commit a finished pen/box stroke or a placed sticker.
  const commitStroke = useCallback(
    (stroke: Stroke) => {
      pushHistory();
      strokesRef.current = [...strokesRef.current, stroke];
      redrawAnnotations();
    },
    [pushHistory, redrawAnnotations],
  );

  const eraseAt = useCallback(
    (p: Point) => {
      const side = sizeRef.current.w;
      const projector = projectorRef.current;
      const before = strokesRef.current.length;
      const next = strokesRef.current.filter((s) => !strokeHit(s, p, ERASE_TOLERANCE, side, projector));
      if (next.length !== before) {
        pushHistory();
        strokesRef.current = next;
        redrawAnnotations();
      }
    },
    [pushHistory, redrawAnnotations],
  );

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

      // The annotation overlay matches the main canvas's size exactly. Resizing wipes
      // its bitmap, so repaint from `strokesRef` (the normalized points scale cleanly
      // to the new side) rather than losing the drawing.
      const annCanvas = annotationCanvasRef.current;
      if (annCanvas) {
        annCanvas.width = Math.round(side * dpr);
        annCanvas.height = Math.round(side * dpr);
        annCanvas.style.width = `${side}px`;
        annCanvas.style.height = `${side}px`;
        const annCtx = annCanvas.getContext('2d');
        if (annCtx) {
          annCtx.setTransform(1, 0, 0, 1, 0, 0);
          annCtx.scale(dpr, dpr);
          annCtxRef.current = annCtx;
        }
      }
      redrawAnnotations();

      draw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [payload, draw, calibration, redrawAnnotations]);

  // --- reset to round start whenever the round changes ---
  useEffect(() => {
    if (!payload?.rounds[roundIdx]) return;
    tickRef.current = roundTickRange(payload.rounds[roundIdx]).start;
  }, [payload, roundIdx]);

  // --- annotations are per-round (drawn on top of that round's positions), so wipe
  //     them when the round changes rather than let them linger over the wrong moment ---
  useEffect(() => {
    strokesRef.current = [];
    drawingRef.current = null;
    historyRef.current = [];
    redrawAnnotations();
  }, [roundIdx, redrawAnnotations]);

  // --- apply a jump's explicit tick once its target round is showing (overrides the
  //     round-reset effect's default "start of round" tick set just above) ---
  useEffect(() => {
    if (!pendingJump || pendingJump.tick === undefined) return;
    if (!payload?.rounds[pendingJump.idx] || roundIdx !== pendingJump.idx) return;
    tickRef.current = pendingJump.tick;
  }, [pendingJump, payload, roundIdx]);


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

  // --- pen tool pointer handling (mouse/touch/pen, via the Pointer Events API) ---
  const pointToNorm = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!tool) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointToNorm(e);
    if (tool === 'eraser') {
      drawingRef.current = { tool: 'eraser' };
      eraseAt(p);
    } else if (tool === 'pen') {
      drawingRef.current = { tool: 'pen', color: penColor, points: [p] };
    } else if (tool === 'box') {
      drawingRef.current = { tool: 'box', color: penColor, a: p, b: p };
    } else {
      // Grenade sticker — fixed size (matches the real AoE), placed immediately.
      commitStroke({ tool, center: p });
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const active = drawingRef.current;
    if (!active) return;
    const p = pointToNorm(e);
    if (active.tool === 'eraser') {
      eraseAt(p);
    } else if (active.tool === 'pen') {
      // Additive — just paint the new segment rather than repainting every stroke.
      const prev = active.points[active.points.length - 1];
      active.points.push(p);
      const ctx = annCtxRef.current;
      if (ctx) paintStroke(ctx, sizeRef.current.w, { ...active, points: [prev, p] }, projectorRef.current);
    } else if (active.tool === 'box') {
      // The shape itself changes every move, so redraw the whole overlay with this
      // stroke as a live preview on top — dragged from `a` (the corner clicked) to
      // `b` (the pointer's current position), not out from a center.
      active.b = p;
      redrawAnnotations(active);
    }
  };

  const endStroke = () => {
    const active = drawingRef.current;
    drawingRef.current = null;
    if (!active || active.tool === 'eraser') return;
    if (active.tool === 'pen' && active.points.length < 2) return;
    if (active.tool === 'box' && Math.hypot(active.b.x - active.a.x, active.b.y - active.a.y) < MIN_BOX_DRAG) return;
    commitStroke(active);
  };

  // Apply an external jump/seek request during render (the React-blessed "adjust state
  // when a prop changes" pattern — guarded by the nonce so it can't loop). Queues the
  // requested round + tick as `pendingJump` for the effect above to apply once that
  // round is showing (immediately, for a same-round jump; after the round-reset effect
  // runs, for a cross-round one).
  if (jump && payload && jump.n !== lastJumpN) {
    setLastJumpN(jump.n);
    const idx = payload.rounds.findIndex((r) => r.round === jump.round);
    if (idx >= 0) {
      setPendingJump({ idx, tick: jump.tick });
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
        <div className="relative">
          <canvas ref={canvasRef} className="block border border-[var(--color-border-primary)]" />
          {/* Pen tool overlay — transparent, sits above the replay canvas. Only
              captures pointer input while a tool is selected, so it never blocks
              anything when annotating is off. */}
          <canvas
            ref={annotationCanvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            className="absolute inset-0 block"
            style={{ touchAction: 'none', pointerEvents: tool ? 'auto' : 'none', cursor: tool ? 'crosshair' : 'default' }}
            aria-hidden="true"
          />
        </div>

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

          <button
            type="button"
            onClick={rewind}
            className="lift-card border border-[var(--color-border-primary)] p-1.5"
            aria-label={`Rewind ${REWIND_SECONDS} seconds`}
            title={`Rewind ${REWIND_SECONDS}s`}
          >
            <Rewind size={14} />
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

        {/* Pen tool — local to this browser tab, never saved */}
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <div className="flex items-center gap-1">
            {(
              [
                { tool: 'pen' as const, Icon: Pencil, label: 'Pen' },
                { tool: 'box' as const, Icon: Square, label: 'Box' },
                { tool: 'eraser' as const, Icon: Eraser, label: 'Eraser' },
              ]
            ).map(({ tool: t, Icon, label }) => (
              <button
                key={t}
                type="button"
                onClick={() => setTool((cur) => (cur === t ? null : t))}
                className={`border p-1.5 ${
                  tool === t
                    ? 'border-[var(--color-text-primary)] text-[var(--color-text-primary)]'
                    : 'border-[var(--color-border-primary)] text-[var(--color-text-secondary)]'
                }`}
                aria-pressed={tool === t}
                aria-label={label}
                title={label}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>

          {/* Grenade stickers — fixed to the effect's real AoE radius, not resizable */}
          <div className="flex items-center gap-1">
            {(
              [
                { kind: 'smoke' as const, label: 'Smoke' },
                { kind: 'molotov' as const, label: 'Molo' },
                { kind: 'he' as const, label: 'HE' },
              ]
            ).map(({ kind, label }) => (
              <button
                key={kind}
                type="button"
                onClick={() => setTool((cur) => (cur === kind ? null : kind))}
                className="border px-1.5 py-1 font-mono"
                style={{
                  borderColor: tool === kind ? STICKER_COLORS[kind] : 'var(--color-border-primary)',
                  color: tool === kind ? STICKER_COLORS[kind] : 'var(--color-text-secondary)',
                }}
                aria-pressed={tool === kind}
                aria-label={`${label} sticker (true size)`}
                title={`${label} sticker — true size`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            {PEN_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setPenColor(c)}
                className="h-5 w-5 rounded-full border-2"
                style={{ backgroundColor: c, borderColor: penColor === c ? 'var(--color-text-primary)' : 'transparent' }}
                aria-pressed={penColor === c}
                aria-label={`Pen color ${c}`}
              />
            ))}
          </div>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={undo}
              className="flex items-center gap-1 border border-[var(--color-border-primary)] px-2 py-1 text-[var(--color-text-secondary)]"
              aria-label="Undo last annotation"
            >
              <Undo2 size={12} /> Undo
            </button>
            <button
              type="button"
              onClick={clearAnnotations}
              className="flex items-center gap-1 border border-[var(--color-border-primary)] px-2 py-1 text-[var(--color-text-secondary)]"
              aria-label="Clear annotations"
            >
              <Trash2 size={12} /> Clear
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
