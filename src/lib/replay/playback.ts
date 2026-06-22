// Derive the visual state of a round at an arbitrary (fractional) tick.
//
// Pure and runtime-agnostic (no DOM, no React, no clock): the browser player drives
// it from a RAF clock, the mp4 Action drives it from a frame counter — both get the
// identical state, so the two renders can't drift. See `docs/replay.md`.
//
// Frames are downsampled (~16fps), so positions are linearly interpolated between
// the two bounding frames; events/grenades are resolved by tick window.

import type {
  ReplayRound,
  ReplayFrame,
  ReplayKillEvent,
  ReplayGrenade,
  Side,
} from './types';
import type { Faction } from '../types';

/** A player's interpolated position/state at the requested tick. */
export interface ViewPlayer {
  id: number;
  x: number;
  y: number;
  yaw: number;
  hp: number;
  alive: boolean;
}

/** A recent kill rendered as a fading tracer line (attacker → victim). */
export interface Tracer {
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** 1 at the moment of the kill, fading to 0 over the tracer window. */
  alpha: number;
}

export interface ActiveGrenade {
  type: string;
  x: number;
  y: number;
  /** True once past `detonateTick` (draw the effect, e.g. smoke cloud, not the nade). */
  detonated: boolean;
}

export interface BombView {
  x: number;
  y: number;
  planted: boolean;
  defused: boolean;
}

/** Everything needed to draw one moment of a round. */
export interface ViewState {
  tick: number;
  players: ViewPlayer[];
  bomb: BombView | null;
  grenades: ActiveGrenade[];
  tracers: Tracer[];
  /** Recent kills, newest first — drives the kill-feed overlay. */
  killFeed: ReplayKillEvent[];
}

/** Seconds a death tracer stays on screen. */
const TRACER_SECONDS = 0.8;
/** Seconds a kill stays in the feed overlay. */
const KILLFEED_SECONDS = 6;
/** Seconds a detonation effect lingers after `detonateTick`. */
const DETONATION_SECONDS = 1.2;

export function roundTickRange(round: ReplayRound): { start: number; end: number } {
  if (round.frames.length === 0) return { start: round.startTick, end: round.endTick };
  return {
    start: round.frames[0].tick,
    end: round.frames[round.frames.length - 1].tick,
  };
}

/** Shortest-path angular lerp (degrees), so a player turning past 360° doesn't spin. */
function lerpAngle(a: number, b: number, t: number): number {
  const diff = ((b - a + 540) % 360) - 180;
  return a + diff * t;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * The two frames bracketing `tick` plus the interpolation fraction between them.
 * Clamps to the ends (fraction 0) when `tick` falls outside the round.
 */
function bracket(
  frames: ReplayFrame[],
  tick: number,
): { lo: ReplayFrame; hi: ReplayFrame; t: number } | null {
  if (frames.length === 0) return null;
  if (tick <= frames[0].tick) return { lo: frames[0], hi: frames[0], t: 0 };
  const last = frames[frames.length - 1];
  if (tick >= last.tick) return { lo: last, hi: last, t: 0 };
  // Linear scan is fine — a round has a few hundred frames at most.
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].tick >= tick) {
      const lo = frames[i - 1];
      const hi = frames[i];
      const span = hi.tick - lo.tick || 1;
      return { lo, hi, t: (tick - lo.tick) / span };
    }
  }
  return { lo: last, hi: last, t: 0 };
}

export function interpolatePlayers(round: ReplayRound, tick: number): ViewPlayer[] {
  const b = bracket(round.frames, tick);
  if (!b) return [];
  const hiById = new Map(b.hi.players.map((p) => [p.id, p]));
  return b.lo.players.map((lo) => {
    const hi = hiById.get(lo.id) ?? lo;
    return {
      id: lo.id,
      x: lerp(lo.x, hi.x, b.t),
      y: lerp(lo.y, hi.y, b.t),
      yaw: lerpAngle(lo.yaw, hi.yaw, b.t),
      // Discrete fields snap at the later frame once we're past the midpoint.
      hp: b.t < 0.5 ? lo.hp : hi.hp,
      alive: b.t < 0.5 ? lo.alive : hi.alive,
    };
  });
}

/**
 * Bomb position is a known Phase-1 payload gap (`frame.bomb` is null), so we
 * reconstruct planted-bomb state from the plant/defuse events: once planted, the
 * bomb sits at the plant site until defused or round end. Pre-plant the bomb is
 * carried and we don't have its position, so it isn't drawn.
 */
export function bombStateAt(round: ReplayRound, tick: number): BombView | null {
  // Prefer a real frame bomb if a future payload ever provides one.
  const b = bracket(round.frames, tick);
  if (b && b.lo.bomb) {
    return { x: b.lo.bomb.x, y: b.lo.bomb.y, planted: b.lo.bomb.planted, defused: false };
  }
  let plant: { x: number; y: number } | null = null;
  let defused = false;
  for (const ev of round.events) {
    if (ev.tick > tick) break; // events are tick-sorted
    if (ev.type === 'plant') plant = { x: ev.x, y: ev.y };
    else if (ev.type === 'defuse') defused = true;
  }
  if (!plant) return null;
  return { x: plant.x, y: plant.y, planted: true, defused };
}

export function activeGrenadesAt(
  round: ReplayRound,
  tick: number,
  tickRate: number,
): ActiveGrenade[] {
  const lingerTicks = DETONATION_SECONDS * tickRate;
  const out: ActiveGrenade[] = [];
  for (const g of round.grenades) {
    if (g.trajectory.length === 0) continue;
    const first = g.trajectory[0].tick;
    const detonate = g.detonateTick ?? g.trajectory[g.trajectory.length - 1].tick;
    if (tick < first || tick > detonate + lingerTicks) continue;
    const pos = grenadePosAt(g, tick);
    out.push({ type: g.type, x: pos.x, y: pos.y, detonated: tick >= detonate });
  }
  return out;
}

function grenadePosAt(g: ReplayGrenade, tick: number): { x: number; y: number } {
  const traj = g.trajectory;
  if (tick <= traj[0].tick) return traj[0];
  const last = traj[traj.length - 1];
  if (tick >= last.tick) return last;
  for (let i = 1; i < traj.length; i++) {
    if (traj[i].tick >= tick) {
      const lo = traj[i - 1];
      const hi = traj[i];
      const span = hi.tick - lo.tick || 1;
      const t = (tick - lo.tick) / span;
      return { x: lerp(lo.x, hi.x, t), y: lerp(lo.y, hi.y, t) };
    }
  }
  return last;
}

export function tracersAt(round: ReplayRound, tick: number, tickRate: number): Tracer[] {
  const windowTicks = TRACER_SECONDS * tickRate;
  const out: Tracer[] = [];
  for (const ev of round.events) {
    if (ev.type !== 'kill') continue;
    if (ev.tick > tick || tick - ev.tick > windowTicks) continue;
    if (!ev.attacker || !ev.victim) continue;
    out.push({
      from: ev.attacker,
      to: ev.victim,
      alpha: 1 - (tick - ev.tick) / windowTicks,
    });
  }
  return out;
}

export function killFeedAt(
  round: ReplayRound,
  tick: number,
  tickRate: number,
): ReplayKillEvent[] {
  const windowTicks = KILLFEED_SECONDS * tickRate;
  const feed: ReplayKillEvent[] = [];
  for (const ev of round.events) {
    if (ev.type !== 'kill') continue;
    if (ev.tick > tick || tick - ev.tick > windowTicks) continue;
    feed.push(ev);
  }
  return feed.reverse(); // newest first
}

/** Compose the full drawable state for a round at `tick`. */
export function viewStateAt(round: ReplayRound, tick: number, tickRate: number): ViewState {
  return {
    tick,
    players: interpolatePlayers(round, tick),
    bomb: bombStateAt(round, tick),
    grenades: activeGrenadesAt(round, tick, tickRate),
    tracers: tracersAt(round, tick, tickRate),
    killFeed: killFeedAt(round, tick, tickRate),
  };
}

/** A player's side this round, from their faction's side assignment. */
export function sideOfPlayer(
  round: ReplayRound,
  faction: Faction | null | undefined,
): Side | null {
  if (!faction) return null;
  return round.sideByFaction[faction] ?? null;
}
