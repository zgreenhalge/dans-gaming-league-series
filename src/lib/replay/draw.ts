// The one and only replay renderer. `drawScene` paints a single moment of a round
// onto a Canvas2D context.
//
// Runtime-agnostic by construction: it talks to a structural `Ctx2D` (the subset of
// CanvasRenderingContext2D it uses) and takes its colors from a passed `ReplayTheme`
// instead of reading CSS — so the browser `<ReplayPlayer>` (DOM canvas, theme from
// CSS vars) and the Phase-4 mp4 Action (`@napi-rs/canvas`, hardcoded theme) call the
// exact same code. There is no second draw path. See `docs/replay.md`.

import type { ReplayPlayerMeta, ReplayRound } from './types';
import type { Faction } from '../types';
import type { Projector, RadarCalibration } from './project';
import type { ViewState, ViewPlayer } from './playback';
import { sideOfPlayer } from './playback';

/** The slice of CanvasRenderingContext2D `drawScene` actually uses. */
export interface Ctx2D {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  lineCap: string;
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  setLineDash(segments: number[]): void;
  drawImage(img: DrawableImage, x: number, y: number, w: number, h: number): void;
}

/** Anything Canvas2D can `drawImage` (DOM HTMLImageElement, napi-rs Image, …). */
export type DrawableImage = unknown;

export interface ReplayTheme {
  bg: string;
  grid: string;
  ct: string;
  t: string;
  text: string;
  textDim: string;
  bomb: string;
  tracer: string;
  smoke: string;
  fire: string;
  flash: string;
  he: string;
  decoy: string;
}

/** Score/clock banner content — the component computes it; draw.ts just renders. */
export interface BannerInfo {
  round: number;
  totalRounds: number;
  ctFaction: Faction;
  tFaction: Faction;
  ctScore: number;
  tScore: number;
}

export interface DrawSceneArgs {
  ctx: Ctx2D;
  width: number;
  height: number;
  projector: Projector;
  state: ViewState;
  round: ReplayRound;
  players: ReplayPlayerMeta[];
  theme: ReplayTheme;
  banner: BannerInfo;
  /** Optional real radar background (Phase 3); falls back to a grid when absent. */
  radar?: { image: DrawableImage; calibration: RadarCalibration } | null;
}

const TWO_PI = Math.PI * 2;
const DOT_RADIUS = 6;

function factionColor(theme: ReplayTheme, round: ReplayRound, faction: Faction | undefined): string {
  const side = sideOfPlayer(round, faction);
  return side === 'CT' ? theme.ct : side === 'T' ? theme.t : theme.textDim;
}

function grenadeColor(theme: ReplayTheme, type: string): string {
  switch (type) {
    case 'smoke':
      return theme.smoke;
    case 'molotov':
    case 'incendiary':
      return theme.fire;
    case 'flashbang':
      return theme.flash;
    case 'decoy':
      return theme.decoy;
    default:
      return theme.he;
  }
}

/**
 * A distinct glyph for each AoE-less grenade detonation so they don't all read as the
 * same dot: HE bursts into spokes, the flashbang is a bright ring + core, and a decoy
 * (or anything else) is a small dot inside a ring. `fade` carries the lifetime/pulse.
 */
function drawPointDetonation(
  ctx: Ctx2D,
  p: { x: number; y: number },
  type: string,
  color: string,
  fade: number,
): void {
  const a = Math.max(0, Math.min(1, fade));
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  if (type === 'he') {
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9 * a;
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * TWO_PI;
      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(ang) * 3, p.y + Math.sin(ang) * 3);
      ctx.lineTo(p.x + Math.cos(ang) * 11, p.y + Math.sin(ang) * 11);
      ctx.stroke();
    }
  } else if (type === 'flashbang') {
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9 * a;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9, 0, TWO_PI);
    ctx.stroke();
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, TWO_PI);
    ctx.fill();
  } else {
    // decoy / unknown — a dot inside a ring (the decoy's fade pulses, so it blinks)
    ctx.globalAlpha = 0.6 * a;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, TWO_PI);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.9 * a;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7, 0, TWO_PI);
    ctx.stroke();
  }
}

/** A planted-C4 glyph: a small body with a blinking arming light — clearly not a nade. */
function drawC4(
  ctx: Ctx2D,
  p: { x: number; y: number },
  theme: ReplayTheme,
  tick: number,
): void {
  const s = 5; // half-side
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.bomb;
  ctx.fillRect(p.x - s, p.y - s, s * 2, s * 2);
  ctx.strokeStyle = theme.bg;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(p.x - s, p.y - s, s * 2, s * 2);
  // Blinking red arming light (period ~0.5s at any frame rate — tick is monotonic).
  const blink = Math.floor(tick / 16) % 2 === 0;
  ctx.globalAlpha = blink ? 1 : 0.25;
  ctx.fillStyle = theme.tracer;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 1.6, 0, TWO_PI);
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function drawScene(args: DrawSceneArgs): void {
  const { ctx, width, height, projector, state, round, players, theme, radar } = args;
  const metaById = new Map(players.map((p) => [p.id, p]));

  // --- background ---
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, width, height);
  if (radar) {
    drawRadar(ctx, projector, radar.image, radar.calibration);
  } else {
    drawGrid(ctx, width, height, theme.grid);
  }

  // --- grenade effects (under players) ---
  for (const g of state.grenades) {
    const p = projector.project(g);
    const color = grenadeColor(theme, g.type);
    if (!g.detonated) {
      // Projectile still in flight — a small travelling dot.
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, TWO_PI);
      ctx.fill();
    } else if (g.radius > 0) {
      // Area effect (smoke bloom / fire), sized to its AoE and fading over its life.
      const r = projector.scaleLength(g.radius);
      ctx.fillStyle = color;
      ctx.globalAlpha = (g.type === 'smoke' ? 0.55 : 0.45) * g.fade;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TWO_PI);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = Math.min(1, g.fade);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TWO_PI);
      ctx.stroke();
    } else {
      // Point detonation — a distinct glyph per type so HE / flash / decoy read apart.
      drawPointDetonation(ctx, p, g.type, color, g.fade);
    }
  }
  ctx.globalAlpha = 1;

  // --- bullet tracers (every shot, faint + thin, under death tracers) ---
  ctx.lineCap = 'round';
  for (const sh of state.shots) {
    const a = projector.project(sh.from);
    const b = projector.project(sh.to);
    ctx.globalAlpha = Math.max(0, Math.min(1, sh.alpha)) * 0.7;
    ctx.strokeStyle = theme.textDim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // --- death tracers (fading) ---
  for (const tr of state.tracers) {
    const a = projector.project(tr.from);
    const b = projector.project(tr.to);
    ctx.globalAlpha = Math.max(0, Math.min(1, tr.alpha)) * 0.8;
    ctx.strokeStyle = theme.tracer;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // --- bomb (planted C4) ---
  if (state.bomb && !state.bomb.defused) {
    drawC4(ctx, projector.project(state.bomb), theme, state.tick);
  }

  // --- players ---
  for (const pl of state.players) {
    const meta = metaById.get(pl.id);
    drawPlayer(ctx, projector, pl, round, meta?.name ?? `#${pl.id}`, meta?.faction, theme);
  }

  // --- overlays ---
  drawScore(ctx, width, args.banner, theme);
  drawKillFeed(ctx, width, state, metaById, round, theme);
}

function drawGrid(ctx: Ctx2D, width: number, height: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.5;
  ctx.setLineDash([]);
  const step = 64;
  for (let x = 0; x <= width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawRadar(
  ctx: Ctx2D,
  projector: Projector,
  image: DrawableImage,
  cal: RadarCalibration,
): void {
  // Project the radar's world-space corners; the calibrated projector places them.
  const tl = projector.project({ x: cal.posX, y: cal.posY });
  const br = projector.project({
    x: cal.posX + cal.imageWidth * cal.scale,
    y: cal.posY - cal.imageHeight * cal.scale,
  });
  ctx.drawImage(image, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
}

function drawPlayer(
  ctx: Ctx2D,
  projector: Projector,
  pl: ViewPlayer,
  round: ReplayRound,
  name: string,
  faction: Faction | undefined,
  theme: ReplayTheme,
): void {
  const p = projector.project(pl);
  const color = factionColor(theme, round, faction);
  ctx.globalAlpha = pl.alive ? 1 : 0.35;

  if (pl.alive) {
    // Facing wedge: a short cone in the eye-yaw direction.
    const rad = (-pl.yaw * Math.PI) / 180; // canvas-y is flipped, so negate yaw
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.arc(p.x, p.y, DOT_RADIUS + 8, rad - 0.5, rad + 0.5);
    ctx.closePath();
    ctx.globalAlpha = (pl.alive ? 1 : 0.35) * 0.4;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Dot
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, DOT_RADIUS, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = theme.bg;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Status overlays (alive only): a red damage blink, then a flash whiteout on top —
  // both fade their alpha to 0, so the dot eases back to its team color.
  if (pl.alive && pl.hurt > 0) {
    ctx.globalAlpha = Math.min(1, pl.hurt) * 0.85;
    ctx.fillStyle = theme.tracer;
    ctx.beginPath();
    ctx.arc(p.x, p.y, DOT_RADIUS, 0, TWO_PI);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (pl.alive && pl.flash > 0) {
    ctx.globalAlpha = Math.min(1, pl.flash);
    ctx.fillStyle = theme.flash;
    ctx.beginPath();
    ctx.arc(p.x, p.y, DOT_RADIUS, 0, TWO_PI);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (!pl.alive) {
    // Death X
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    const r = DOT_RADIUS - 1;
    ctx.beginPath();
    ctx.moveTo(p.x - r, p.y - r);
    ctx.lineTo(p.x + r, p.y + r);
    ctx.moveTo(p.x + r, p.y - r);
    ctx.lineTo(p.x - r, p.y + r);
    ctx.stroke();
  }

  // Name label
  ctx.globalAlpha = pl.alive ? 1 : 0.5;
  ctx.fillStyle = theme.text;
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(name, p.x, p.y + DOT_RADIUS + 3);
  ctx.globalAlpha = 1;
}

function drawScore(ctx: Ctx2D, width: number, banner: BannerInfo, theme: ReplayTheme): void {
  const cx = width / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 14px ui-monospace, monospace';
  ctx.fillStyle = theme.ct;
  ctx.fillText(String(banner.ctScore), cx - 28, 8);
  ctx.fillStyle = theme.textDim;
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillText(`R${banner.round}`, cx, 11);
  ctx.font = 'bold 14px ui-monospace, monospace';
  ctx.fillStyle = theme.t;
  ctx.fillText(String(banner.tScore), cx + 28, 8);
}

function drawKillFeed(
  ctx: Ctx2D,
  width: number,
  state: ViewState,
  nameById: Map<number, ReplayPlayerMeta>,
  round: ReplayRound,
  theme: ReplayTheme,
): void {
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.font = '11px ui-monospace, monospace';
  let y = 8;
  for (const k of state.killFeed.slice(0, 6)) {
    const victim = nameById.get(k.victimId);
    const attacker = k.attackerId !== null ? nameById.get(k.attackerId) : null;
    const vColor = factionColor(theme, round, victim?.faction);
    const aColor = attacker ? factionColor(theme, round, attacker.faction) : theme.textDim;
    const x = width - 8;
    // victim (rightmost)
    ctx.fillStyle = vColor;
    const vName = victim?.name ?? `#${k.victimId}`;
    ctx.fillText(vName, x, y);
    // separator + attacker
    ctx.fillStyle = theme.textDim;
    const sep = `  ${weaponShort(k.weapon)}${k.headshot ? ' ⊙' : ''}  `;
    // crude right-to-left layout: draw attacker further left by a fixed gutter
    ctx.fillStyle = aColor;
    ctx.fillText(`${attacker?.name ?? 'world'}${sep}`, x - measureApprox(vName), y);
    y += 16;
  }
}

function weaponShort(weapon: string | null): string {
  if (!weapon) return '';
  return weapon.replace(/^weapon_/, '');
}

// We avoid measureText (not in our structural Ctx2D); approximate monospace width.
function measureApprox(text: string): number {
  return text.length * 6.6;
}
