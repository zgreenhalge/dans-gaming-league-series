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
  isKnifeRound?: boolean;
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
  /** Roster keyed by player id, built once by the caller (constant across a round). */
  metaById: ReadonlyMap<number, ReplayPlayerMeta>;
  /** Engine ticks per second — times the C4 arming-light blink to wall-clock. */
  tickRate: number;
  theme: ReplayTheme;
  banner: BannerInfo;
  /** Optional real radar background (Phase 3); falls back to a grid when absent. */
  radar?: { image: DrawableImage; calibration: RadarCalibration } | null;
}

const TWO_PI = Math.PI * 2;
const DOT_RADIUS = 6;
/** Half a blink cycle (light on, then off) for the planted-C4 arming light, in seconds. */
const C4_BLINK_HALF_SECONDS = 0.25;
/** Smoke puff-ring rotation, in radians per engine tick — a slow churn (~one turn / 20s @64t). */
const SMOKE_SPIN_RATE = 0.005;

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

/**
 * Smoke as a soft cloud: a dense core ringed by translucent puffs, so it billows
 * instead of reading as one hard disc. The puff ring rotates slowly with the tick
 * (`SMOKE_SPIN_RATE`) for a gentle churn — deterministic, so it's identical in the
 * browser and headless renders. `fade` carries its lifetime.
 */
function drawSmokeCloud(
  ctx: Ctx2D,
  c: { x: number; y: number },
  r: number,
  color: string,
  fade: number,
  tick: number,
): void {
  const a = Math.max(0, Math.min(1, fade));
  ctx.fillStyle = color;
  const puffs = 6;
  const spin = tick * SMOKE_SPIN_RATE;
  for (let i = 0; i < puffs; i++) {
    const ang = (i / puffs) * TWO_PI + spin;
    const px = c.x + Math.cos(ang) * r * 0.45;
    const py = c.y + Math.sin(ang) * r * 0.45;
    ctx.globalAlpha = 0.22 * a;
    ctx.beginPath();
    ctx.arc(px, py, r * 0.62, 0, TWO_PI);
    ctx.fill();
  }
  ctx.globalAlpha = 0.5 * a;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r * 0.68, 0, TWO_PI);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/**
 * Fire as flickering tongues: several warm blobs around the burn area whose size and
 * brightness pulse with the tick, plus a hot center. Unlike smoke this animates, so a
 * molotov/incendiary clearly reads as live fire rather than a static cloud.
 */
function drawFire(
  ctx: Ctx2D,
  c: { x: number; y: number },
  r: number,
  color: string,
  fade: number,
  tick: number,
): void {
  const a = Math.max(0, Math.min(1, fade));
  ctx.fillStyle = color;
  const tongues = 7;
  for (let i = 0; i < tongues; i++) {
    const ang = (i / tongues) * TWO_PI + i;
    const px = c.x + Math.cos(ang) * r * 0.5;
    const py = c.y + Math.sin(ang) * r * 0.5;
    // Deterministic flicker: a per-tongue phase keeps neighbours out of sync.
    const flick = 0.55 + 0.45 * Math.abs(Math.sin(tick * 0.5 + i * 1.7));
    ctx.globalAlpha = Math.min(1, (0.35 + 0.3 * flick) * a);
    ctx.beginPath();
    ctx.arc(px, py, r * 0.34 * flick, 0, TWO_PI);
    ctx.fill();
  }
  ctx.globalAlpha = 0.45 * a;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r * 0.42, 0, TWO_PI);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/**
 * The C4 blast: an expanding bright ring plus a translucent fireball, both fading over
 * the explosion window. `fade` is 1 at detonation → 0 at the end, so the ring grows as
 * the blast dies out.
 */
function drawExplosion(
  ctx: Ctx2D,
  c: { x: number; y: number },
  maxR: number,
  fade: number,
  theme: ReplayTheme,
): void {
  const a = Math.max(0, Math.min(1, fade));
  const progress = 1 - a; // 0 at the flash, 1 at the end
  const r = maxR * (0.3 + 0.7 * progress);
  // Fireball
  ctx.fillStyle = theme.fire;
  ctx.globalAlpha = 0.45 * a;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r * 0.7, 0, TWO_PI);
  ctx.fill();
  // Shock ring
  ctx.strokeStyle = theme.bomb;
  ctx.lineWidth = 3;
  ctx.globalAlpha = a;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, TWO_PI);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * A C4 glyph: a small body with a red light — clearly not a nade. `blink` arms the
 * light (planted); `alpha` dims it (dropped on the ground); `half` sizes it (a smaller
 * badge when riding a carrier).
 */
function drawC4(
  ctx: Ctx2D,
  p: { x: number; y: number },
  theme: ReplayTheme,
  tick: number,
  tickRate: number,
  opts: { blink: boolean; alpha?: number; half?: number } = { blink: true },
): void {
  const s = opts.half ?? 5;
  const a = opts.alpha ?? 1;
  ctx.globalAlpha = a;
  ctx.fillStyle = theme.bomb;
  ctx.fillRect(p.x - s, p.y - s, s * 2, s * 2);
  ctx.strokeStyle = theme.bg;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(p.x - s, p.y - s, s * 2, s * 2);
  // Arming light: blinks when planted, ~0.5s on/off in wall-clock time regardless of the
  // demo's tick rate (tick is monotonic engine ticks, so the half-period scales with it).
  const halfPeriodTicks = Math.max(1, C4_BLINK_HALF_SECONDS * tickRate);
  const lit = opts.blink ? Math.floor(tick / halfPeriodTicks) % 2 === 0 : true;
  ctx.globalAlpha = (lit ? 1 : 0.25) * a;
  ctx.fillStyle = theme.tracer;
  ctx.beginPath();
  ctx.arc(p.x, p.y, Math.max(1.2, s * 0.32), 0, TWO_PI);
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function drawScene(args: DrawSceneArgs): void {
  const { ctx, width, height, projector, state, round, metaById, tickRate, theme, radar } = args;

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
      // Area effect, sized to its AoE and fading over its life. Smoke reads as a soft
      // billowing cloud; fire as flickering tongues — so the two don't look like the
      // same flat disc (issue #128).
      const r = projector.scaleLength(g.radius);
      if (g.type === 'smoke') {
        drawSmokeCloud(ctx, p, r, color, g.fade, state.tick);
      } else {
        drawFire(ctx, p, r, color, g.fade, state.tick);
      }
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

  // --- bomb (C4): carried on its holder, dropped dimmed, planted blinking ---
  if (state.bomb && !state.bomb.defused) {
    const bp = projector.project(state.bomb);
    if (state.bomb.carried) {
      // A small badge offset up-right from the carrier's dot.
      drawC4(ctx, { x: bp.x + DOT_RADIUS + 3, y: bp.y - DOT_RADIUS - 1 }, theme, state.tick, tickRate, {
        blink: false,
        half: 3.5,
      });
    } else if (state.bomb.planted) {
      drawC4(ctx, bp, theme, state.tick, tickRate, { blink: true });
    } else {
      drawC4(ctx, bp, theme, state.tick, tickRate, { blink: false, alpha: 0.6 });
    }
  }

  // --- C4 detonation blast (over the radar, under players) ---
  if (state.explosion) {
    drawExplosion(ctx, projector.project(state.explosion), projector.scaleLength(280), state.explosion.fade, theme);
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

  // Dot. For the living, the team-colour fill rises from the bottom with remaining HP
  // (the missing chunk stays dimmed), so a hurt player reads as a partly-drained dot.
  ctx.fillStyle = color;
  if (pl.alive) {
    ctx.globalAlpha = 0.25; // dim base = the "missing" HP
    ctx.beginPath();
    ctx.arc(p.x, p.y, DOT_RADIUS, 0, TWO_PI);
    ctx.fill();
    ctx.globalAlpha = 1;
    fillHpSegment(ctx, p.x, p.y, DOT_RADIUS, clamp01(pl.hp / 100), color);
  } else {
    ctx.beginPath();
    ctx.arc(p.x, p.y, DOT_RADIUS, 0, TWO_PI);
    ctx.fill();
  }
  ctx.strokeStyle = theme.bg;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(p.x, p.y, DOT_RADIUS, 0, TWO_PI);
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
  ctx.fillText(banner.isKnifeRound ? 'KNIFE' : `R${banner.round}`, cx, 11);
  ctx.font = 'bold 14px ui-monospace, monospace';
  ctx.fillStyle = theme.t;
  ctx.fillText(String(banner.tScore), cx + 28, 8);
}

function drawKillFeed(
  ctx: Ctx2D,
  width: number,
  state: ViewState,
  nameById: ReadonlyMap<number, ReplayPlayerMeta>,
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
    const sep = `  ${killWeaponLabel(round, k)}${k.headshot ? ' ⊙' : ''}  `;
    // crude right-to-left layout: draw attacker further left by a fixed gutter
    ctx.fillStyle = aColor;
    ctx.fillText(`${attacker?.name ?? 'world'}${sep}`, x - measureApprox(vName), y);
    y += 16;
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Fill the lower `frac` of a dot as a circular segment (canvas y grows downward, so the
 * fill rises from the bottom). `frac` 1 fills the whole dot, 0 fills nothing.
 */
function fillHpSegment(ctx: Ctx2D, cx: number, cy: number, r: number, frac: number, color: string): void {
  if (frac <= 0) return;
  ctx.fillStyle = color;
  if (frac >= 1) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TWO_PI);
    ctx.fill();
    return;
  }
  // Waterline chord at y = cy + r(1 - 2·frac); fill the arc below it. asin's argument is
  // in [-1, 1] for frac in [0, 1], so no extra clamp is needed.
  const a0 = Math.asin(1 - 2 * frac);
  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, Math.PI - a0);
  ctx.closePath();
  ctx.fill();
}

function weaponShort(weapon: string | null): string {
  if (!weapon) return '';
  return weapon.replace(/^weapon_/, '');
}

/**
 * Kill-feed weapon label. Fire damage is reported by the engine as `inferno`, which
 * doesn't say whether it was a molotov or an incendiary — those aren't the same nade
 * (issue #128). Recover the distinction by matching the kill to the attacker's most
 * recent fire grenade; fall back to a generic `fire` when none can be correlated.
 */
function killWeaponLabel(round: ReplayRound, k: { weapon: string | null; attackerId: number | null; tick: number }): string {
  const w = weaponShort(k.weapon);
  if (w !== 'inferno') return w;
  let best: string | null = null;
  let bestTick = -Infinity;
  for (const g of round.grenades) {
    if (g.type !== 'molotov' && g.type !== 'incendiary') continue;
    if (k.attackerId !== null && g.throwerId !== null && g.throwerId !== k.attackerId) continue;
    const dt = g.detonateTick ?? (g.trajectory.length ? g.trajectory[g.trajectory.length - 1].tick : null);
    if (dt === null || dt > k.tick) continue;
    if (dt > bestTick) {
      bestTick = dt;
      best = g.type;
    }
  }
  return best ?? 'fire';
}

// We avoid measureText (not in our structural Ctx2D); approximate monospace width.
function measureApprox(text: string): number {
  return text.length * 6.6;
}
