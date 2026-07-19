// World (CS2 units) → canvas-pixel projection for the 2D replay.
//
// Runtime-agnostic and pure (no DOM, no React): the browser `<ReplayPlayer>`, the
// admin calibration overlay (Phase 3), the map heatmap, and the headless mp4 render
// (Phase 4) all share this one module so a position never plots two different ways.
// See `docs/replay.md`.
//
// Two modes behind one `Projector` interface:
//   - auto-fit   — fit the bounding box of every position into the canvas (no map
//                  calibration needed; works on every map day one).
//   - calibrated — use a map's radar triplet (`radar_pos_x/y`, `radar_scale`) to plot
//                  onto its real top-down radar image (Phase 3).

import type { ReplayPayload, Point } from './types';

/** Projects a world (x, y) onto canvas pixels. y grows downward in canvas space. */
export interface Projector {
  project(world: Point): Point;
  /** Scale a world-space length (e.g. a grenade radius) to pixels. */
  scaleLength(worldLen: number): number;
}

/** A map's radar calibration, as stored on the `maps` row (Phase 3). */
export interface RadarCalibration {
  /** World coords of the radar image's top-left corner. */
  posX: number;
  posY: number;
  /** World units per radar-image pixel (the CS `overview.txt` `scale`). */
  scale: number;
  /** Natural pixel size of the radar image. */
  imageWidth: number;
  imageHeight: number;
}

/**
 * Calibrated projection: world → radar-image px → canvas px.
 *
 * CS overviews define `pos_x/pos_y` as the world coordinate of the image's
 * top-left, with world-y increasing upward but image rows increasing downward, so
 * the y term is negated (the standard de_* radar transform).
 */
export function calibratedProjector(
  cal: RadarCalibration,
  canvasWidth: number,
  canvasHeight: number,
): Projector {
  // Letterbox the (possibly non-square) radar into the canvas, preserving aspect.
  const fit = Math.min(canvasWidth / cal.imageWidth, canvasHeight / cal.imageHeight);
  const offsetX = (canvasWidth - cal.imageWidth * fit) / 2;
  const offsetY = (canvasHeight - cal.imageHeight * fit) / 2;
  return {
    project({ x, y }) {
      const imgX = (x - cal.posX) / cal.scale;
      const imgY = (cal.posY - y) / cal.scale;
      return { x: offsetX + imgX * fit, y: offsetY + imgY * fit };
    },
    scaleLength(worldLen) {
      return (worldLen / cal.scale) * fit;
    },
  };
}

/** The world-space bounding box of a set of points. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Bounding box of every player position (and located event/grenade point) across
 * the whole match. This is what auto-fit fits the canvas to — computed once per
 * payload, not per frame.
 */
export function payloadBounds(payload: ReplayPayload): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const acc = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const round of payload.rounds) {
    for (const f of round.frames) {
      for (const p of f.players) acc(p.x, p.y);
      if (f.bomb) acc(f.bomb.x, f.bomb.y);
    }
    for (const g of round.grenades) for (const pt of g.trajectory) acc(pt.x, pt.y);
  }
  if (!Number.isFinite(minX)) return null; // no located positions at all
  return { minX, minY, maxX, maxY };
}

/**
 * Auto-fit projection: fit `bounds` into the canvas with uniform scale (aspect
 * preserved) and a pixel padding margin. World-y is flipped so north is up.
 */
export function autoFitProjector(
  bounds: Bounds,
  canvasWidth: number,
  canvasHeight: number,
  padding = 24,
): Projector {
  const worldW = Math.max(1, bounds.maxX - bounds.minX);
  const worldH = Math.max(1, bounds.maxY - bounds.minY);
  const availW = Math.max(1, canvasWidth - padding * 2);
  const availH = Math.max(1, canvasHeight - padding * 2);
  const scale = Math.min(availW / worldW, availH / worldH); // px per world unit
  // Center the scaled box in the available area.
  const drawnW = worldW * scale;
  const drawnH = worldH * scale;
  const offsetX = padding + (availW - drawnW) / 2;
  const offsetY = padding + (availH - drawnH) / 2;
  return {
    project({ x, y }) {
      return {
        x: offsetX + (x - bounds.minX) * scale,
        // flip y: larger world-y → higher on screen (smaller canvas-y)
        y: offsetY + (bounds.maxY - y) * scale,
      };
    },
    scaleLength(worldLen) {
      return worldLen * scale;
    },
  };
}

/**
 * Pick the right projector for a payload: calibrated when the map has a radar
 * triplet, else auto-fit over the payload's own bounds. Returns `null` only when a
 * payload has no positions to fit and no calibration (degenerate/empty replay).
 */
export function projectorFor(
  payload: ReplayPayload,
  canvasWidth: number,
  canvasHeight: number,
  calibration: RadarCalibration | null,
): Projector | null {
  if (calibration) return calibratedProjector(calibration, canvasWidth, canvasHeight);
  const bounds = payloadBounds(payload);
  if (!bounds) return null;
  return autoFitProjector(bounds, canvasWidth, canvasHeight);
}

/**
 * Count of distinct matches represented in a list of match-scoped items (heatmap
 * points, player-trace rounds) — shared by the Heatmap and Pathing tabs' "N games"
 * caption alongside their raw point/round count.
 */
export function countDistinctMatches(items: { matchId: number }[]): number {
  return new Set(items.map((i) => i.matchId)).size;
}

/**
 * The bounding box of a flat list of world-space points, or `null` if empty. Shared
 * point-cloud variant of `payloadBounds()` above, for callers that already have their
 * own `{x, y}` list (the map heatmap's points, the aggregate replay overlay's trace
 * frames) rather than a whole `ReplayPayload`.
 */
export function boundsOfPoints(points: Point[]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** The slice of Canvas2D `drawRadarBackground` needs — a DOM `CanvasRenderingContext2D`
 *  or a napi-rs canvas context both satisfy this structurally, no cast required. */
export interface RadarDrawContext {
  globalAlpha: number;
  drawImage(image: unknown, x: number, y: number, w: number, h: number): void;
}

/**
 * Draws a map's calibrated radar image onto `ctx`, positioned via `projector`. Shared
 * by every radar-backed canvas (2D Replay, Map Heatmap, Player Trails overlay) so the
 * corner projection math lives in one place. `alpha` defaults to the point-overlay
 * convention (points/dots read clearly through a slightly translucent radar); the full
 * 2D Replay draws its radar opaque by passing `1`.
 */
export function drawRadarBackground(
  ctx: RadarDrawContext,
  projector: Projector,
  image: unknown,
  cal: RadarCalibration,
  alpha = 0.85,
): void {
  const tl = projector.project({ x: cal.posX, y: cal.posY });
  const br = projector.project({
    x: cal.posX + cal.imageWidth * cal.scale,
    y: cal.posY - cal.imageHeight * cal.scale,
  });
  ctx.globalAlpha = alpha;
  ctx.drawImage(image, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  ctx.globalAlpha = 1;
}
