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
  /** Flash whiteout intensity, 0 (clear) → 1 (fully blinded). */
  flash: number;
  /** Damage blink intensity, 0 (none) → 1 (just hit). */
  hurt: number;
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
  /** Area-of-effect radius in WORLD units (0 for in-flight / point grenades). */
  radius: number;
  /** 1 at detonation fading to 0 at the end of the effect's linger; 1 while in flight. */
  fade: number;
}

/** A single bullet's tracer, cast as a ray from the shooter along their aim. */
export interface ShotTracer {
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** 1 at the shot, fading to 0 over the (short) tracer window. */
  alpha: number;
}

export interface BombView {
  x: number;
  y: number;
  planted: boolean;
  defused: boolean;
  /** True while a player is carrying it (drawn on the carrier). */
  carried: boolean;
  /** The carrier's player id when `carried`, else null. */
  carrierId: number | null;
}

/** A bomb detonation blast at the plant site, fading over its (short) lifetime. */
export interface BombExplosion {
  x: number;
  y: number;
  /** 1 at the moment of detonation, fading to 0 over `EXPLOSION_SECONDS`. */
  fade: number;
}

/** Everything needed to draw one moment of a round. */
export interface ViewState {
  tick: number;
  players: ViewPlayer[];
  bomb: BombView | null;
  grenades: ActiveGrenade[];
  tracers: Tracer[];
  /** Bullet tracers active at this tick (every shot, not just kills). */
  shots: ShotTracer[];
  /** Recent kills, newest first — drives the kill-feed overlay. */
  killFeed: ReplayKillEvent[];
  /** The C4 blast, present only for the brief window after a bomb-explosion round end. */
  explosion: BombExplosion | null;
}

/** Seconds a death tracer stays on screen. */
const TRACER_SECONDS = 0.8;
/** Seconds a bullet tracer stays on screen — a brief muzzle-flash blip. */
const SHOT_TRACER_SECONDS = 0.1;
/** World-unit length of a bullet tracer ray — a short stub, not a map-spanning line. */
const SHOT_TRACER_LENGTH = 450;
/** Seconds a kill stays in the feed overlay. */
const KILLFEED_SECONDS = 6;

/**
 * Per-grenade-type detonation effect: how long it lingers after `detonateTick` and
 * its area-of-effect radius in world units. Smoke blooms wide and lasts longest;
 * incendiary covers a larger area than a molotov; both burn ~7s. HE's radius is half
 * its real blast range so the AoE ring reads as a guide without overwhelming the radar.
 * Flash/decoy are point pops
 * with no AoE disc. Values are tuned to read well on the 2D radar, not to mirror
 * exact CS2 timings. See `docs/replay.md`.
 */
const GRENADE_EFFECT: Record<string, { linger: number; radius: number }> = {
  smoke: { linger: 18, radius: 144 },
  molotov: { linger: 7, radius: 130 },
  incendiary: { linger: 7, radius: 165 },
  he: { linger: 0.6, radius: 175 },
  flashbang: { linger: 0.4, radius: 0 },
  decoy: { linger: 15, radius: 0 },
};
const DEFAULT_EFFECT = { linger: 1.2, radius: 0 };
const effectFor = (type: string) => GRENADE_EFFECT[type] ?? DEFAULT_EFFECT;

/** World-unit AoE radius for a grenade type — exposed so other surfaces (e.g. the 2D
 *  Replay's pen-tool grenade stickers) can size themselves to match the real effect. */
export function grenadeEffectRadius(type: 'smoke' | 'molotov' | 'incendiary' | 'he'): number {
  return GRENADE_EFFECT[type].radius;
}

/** Decoy "fires" intermittently — period (s) and the bright fraction of each cycle. */
const DECOY_PULSE_SECONDS = 0.9;
const DECOY_PULSE_DUTY = 0.3;

/** Seconds a damage hit blinks the player red. Fire re-triggers it every burn tick. */
const HURT_BLINK_SECONDS = 0.5;

/** Seconds the C4 detonation blast stays on screen after the bomb explodes. */
const EXPLOSION_SECONDS = 1;

export function roundTickRange(round: ReplayRound): { start: number; end: number } {
  if (round.frames.length === 0) return { start: round.startTick, end: round.endTick };
  return {
    start: round.frames[0].tick,
    end: round.frames[round.frames.length - 1].tick,
  };
}

/** Shortest-path angular lerp (degrees), so a player turning past 360° doesn't spin. */
export function lerpAngle(a: number, b: number, t: number): number {
  const diff = ((b - a + 540) % 360) - 180;
  return a + diff * t;
}

export function lerp(a: number, b: number, t: number): number {
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
      // Status effects are overlaid by viewStateAt (they live on the round, not the
      // frame); default to clear so interpolatePlayers stays position-only.
      flash: 0,
      hurt: 0,
    };
  });
}

/**
 * Per-player flash whiteout at `tick`, keyed by player id. A `player_blind` whites the
 * player out fully, fading linearly back to team color over its `duration`. Overlapping
 * flashes take the strongest. Players past their blind window aren't in the map.
 */
export function flashAt(round: ReplayRound, tick: number, tickRate: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const b of round.blinds ?? []) {
    if (b.playerId === null) continue;
    const windowTicks = b.duration * tickRate;
    if (b.tick > tick || tick - b.tick > windowTicks) continue;
    const intensity = 1 - (tick - b.tick) / (windowTicks || 1);
    out.set(b.playerId, Math.max(out.get(b.playerId) ?? 0, intensity));
  }
  return out;
}

/**
 * Per-player damage blink at `tick`, keyed by player id. Each `player_hurt` blinks the
 * player red, fading over `HURT_BLINK_SECONDS`; fire ticks re-trigger it for a steady
 * burn. Overlapping hits take the strongest.
 */
export function hurtAt(round: ReplayRound, tick: number, tickRate: number): Map<number, number> {
  const windowTicks = HURT_BLINK_SECONDS * tickRate;
  const out = new Map<number, number>();
  for (const h of round.hurts ?? []) {
    if (h.playerId === null) continue;
    if (h.tick > tick || tick - h.tick > windowTicks) continue;
    const intensity = 1 - (tick - h.tick) / (windowTicks || 1);
    out.set(h.playerId, Math.max(out.get(h.playerId) ?? 0, intensity));
  }
  return out;
}

/**
 * Resolve the bomb at `tick`. A *planted* bomb (from plant/defuse events) takes
 * priority once it's down. Otherwise we read the carrier change-points: while carried,
 * the bomb rides the carrier's interpolated position; once dropped (`carrierId: null`)
 * it sits where the carrier was at the drop tick until the next pickup/plant. Positions
 * are derived from frames here — `players` (already interpolated for `tick`) is reused
 * for the carried case to avoid recomputing.
 */
export function bombStateAt(
  round: ReplayRound,
  tick: number,
  players?: ViewPlayer[],
): BombView | null {
  // Planted state from events wins once the bomb is down.
  let plant: { x: number; y: number } | null = null;
  let defused = false;
  let detonated = false;
  for (const ev of round.events) {
    if (ev.tick > tick) break; // events are tick-sorted
    if (ev.type === 'plant') plant = { x: ev.x, y: ev.y };
    else if (ev.type === 'defuse') defused = true;
    else if (ev.type === 'round_end' && ev.condition === 'bomb') detonated = true;
  }
  // Once the planted bomb explodes the C4 is gone — drop the icon so it doesn't linger
  // into the post-round window. The blast itself is drawn from `bombExplosionAt`.
  if (plant && detonated) return null;
  if (plant) {
    return { x: plant.x, y: plant.y, planted: true, defused, carried: false, carrierId: null };
  }

  // Otherwise resolve from the carrier change-points (seed + pickups/drops).
  const points = round.bombCarrier ?? [];
  let cur: { tick: number; carrierId: number | null } | null = null;
  for (const p of points) {
    if (p.tick > tick) break; // points are tick-sorted
    cur = p;
  }
  if (!cur) return null;

  if (cur.carrierId !== null) {
    const carrier = playerPosAt(round, cur.carrierId, tick, players);
    if (!carrier) return null;
    return {
      x: carrier.x,
      y: carrier.y,
      planted: false,
      defused: false,
      carried: true,
      carrierId: cur.carrierId,
    };
  }

  // Dropped: park it where the last carrier was at the drop tick.
  let dropper: number | null = null;
  for (const p of points) {
    if (p.tick > cur.tick) break;
    if (p.carrierId !== null) dropper = p.carrierId;
  }
  if (dropper === null) return null;
  const at = playerPosAt(round, dropper, cur.tick);
  if (!at) return null;
  return { x: at.x, y: at.y, planted: false, defused: false, carried: false, carrierId: null };
}

/**
 * A player's position at `tick`, falling back to their last known frame before it. The
 * carrier of a just-dropped bomb has often died on that same tick and may be gone from
 * the frames bracketing it; without this fallback the bomb would vanish from the radar
 * instead of resting at the drop spot.
 */
function playerPosAt(
  round: ReplayRound,
  id: number,
  tick: number,
  players?: ViewPlayer[],
): { x: number; y: number } | null {
  const here = (players ?? interpolatePlayers(round, tick)).find((p) => p.id === id);
  if (here) return here;
  for (let i = round.frames.length - 1; i >= 0; i--) {
    const f = round.frames[i];
    if (f.tick > tick) continue;
    const pl = f.players.find((p) => p.id === id);
    if (pl) return { x: pl.x, y: pl.y };
  }
  return null;
}

/**
 * The C4 blast at `tick`, or null. A round won by `bomb` detonates at its `round_end`
 * tick at the plant site; the blast fades over `EXPLOSION_SECONDS`. Derived entirely
 * from existing events (plant position + round_end condition), so no schema change.
 */
export function bombExplosionAt(
  round: ReplayRound,
  tick: number,
  tickRate: number,
): BombExplosion | null {
  let plant: { x: number; y: number } | null = null;
  let detonateTick: number | null = null;
  for (const ev of round.events) {
    if (ev.type === 'plant') plant = { x: ev.x, y: ev.y };
    else if (ev.type === 'round_end' && ev.condition === 'bomb') detonateTick = ev.tick;
  }
  if (!plant || detonateTick === null || tick < detonateTick) return null;
  const windowTicks = EXPLOSION_SECONDS * tickRate;
  if (tick - detonateTick > windowTicks) return null;
  return { x: plant.x, y: plant.y, fade: 1 - (tick - detonateTick) / (windowTicks || 1) };
}

export function activeGrenadesAt(
  round: ReplayRound,
  tick: number,
  tickRate: number,
): ActiveGrenade[] {
  const out: ActiveGrenade[] = [];
  for (const g of round.grenades) {
    if (g.trajectory.length === 0) continue;
    const first = g.trajectory[0].tick;
    const detonate = g.detonateTick ?? g.trajectory[g.trajectory.length - 1].tick;
    const eff = effectFor(g.type);
    const lingerTicks = eff.linger * tickRate;
    if (tick < first || tick > detonate + lingerTicks) continue;
    const pos = grenadePosAt(g, tick);
    const detonated = tick >= detonate;
    let fade = detonated ? Math.max(0, 1 - (tick - detonate) / (lingerTicks || 1)) : 1;
    // A decoy isn't a steady glow — it pops gunshots intermittently. Gate its fade
    // with a periodic duty cycle so the dot blinks on and off over its 15s life.
    if (detonated && g.type === 'decoy') {
      const periodTicks = DECOY_PULSE_SECONDS * tickRate || 1;
      const phase = ((tick - detonate) % periodTicks) / periodTicks;
      fade *= phase < DECOY_PULSE_DUTY ? 1 : 0.15;
    }
    out.push({ type: g.type, x: pos.x, y: pos.y, detonated, radius: eff.radius, fade });
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

/**
 * Bullet tracers active at `tick`, one per recent `weapon_fire`. The event carries no
 * impact point, so each tracer is cast from the shooter's *current* interpolated
 * position along their yaw — in WORLD space, so the projector applies the y-flip
 * (don't negate yaw here, unlike a direct canvas draw). A shooter who isn't currently
 * in-frame or alive (e.g. already traded) is skipped. Fades over `SHOT_TRACER_SECONDS`.
 */
export function shotTracersAt(
  round: ReplayRound,
  tick: number,
  tickRate: number,
  players: ViewPlayer[],
): ShotTracer[] {
  const shots = round.shots ?? [];
  if (shots.length === 0) return [];
  const windowTicks = SHOT_TRACER_SECONDS * tickRate;
  const byId = new Map(players.map((p) => [p.id, p]));
  const out: ShotTracer[] = [];
  for (const s of shots) {
    if (s.shooterId === null) continue;
    if (s.tick > tick || tick - s.tick > windowTicks) continue;
    const shooter = byId.get(s.shooterId);
    if (!shooter || !shooter.alive) continue;
    const rad = (shooter.yaw * Math.PI) / 180;
    out.push({
      from: { x: shooter.x, y: shooter.y },
      to: {
        x: shooter.x + Math.cos(rad) * SHOT_TRACER_LENGTH,
        y: shooter.y + Math.sin(rad) * SHOT_TRACER_LENGTH,
      },
      alpha: 1 - (tick - s.tick) / windowTicks,
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
  const players = interpolatePlayers(round, tick);
  // Overlay per-player status effects (flash / damage) onto the interpolated dots.
  // Dead players show neither — the source events stop while they're down.
  const flash = flashAt(round, tick, tickRate);
  const hurt = hurtAt(round, tick, tickRate);
  for (const p of players) {
    if (!p.alive) continue;
    p.flash = flash.get(p.id) ?? 0;
    p.hurt = hurt.get(p.id) ?? 0;
  }
  return {
    tick,
    players,
    bomb: bombStateAt(round, tick, players),
    grenades: activeGrenadesAt(round, tick, tickRate),
    tracers: tracersAt(round, tick, tickRate),
    shots: shotTracersAt(round, tick, tickRate, players),
    killFeed: killFeedAt(round, tick, tickRate),
    explosion: bombExplosionAt(round, tick, tickRate),
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
