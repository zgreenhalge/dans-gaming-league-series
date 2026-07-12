import type { SabFields } from '../types';
import type { MatchContext } from './matchContext';

type CollectorOut = Map<string, Partial<SabFields>>;

export interface SmokeEventRow {
  tick: number;
  total_rounds_played: number;
  entityid: number;
  user_steamid: string | null;
  x: number;
  y: number;
}

export interface PlayerPositionRow {
  tick: number;
  steamid: string;
  x: number;
  y: number;
}

// How far apart (seconds) to sample enemy positions during a smoke's life. Sampling every tick
// over an ~18s smoke duration for every smoke thrown in a match would be far more tick data
// than this stat needs.
const SAMPLE_INTERVAL_SECONDS = 2;

// "Close enough to interfere with a push" radius (game units) — matches Leetify's own
// "[CT] Smokes That Stopped a Push" glossary definition exactly (800 map units).
const SMOKE_BLOCK_RADIUS = 800;

interface SmokeLife {
  round: number;
  thrower: string;
  x: number;
  y: number;
  startTick: number;
  endTick: number;
}

/** detonate/expire share the same entityid — confirmed against a real DGLS demo. Entity ids
 *  recycle across rounds, so pairing is scoped to (round, entityid), same as
 *  replay/extract.ts's grenade-throw grouping. A smoke with no matching expire event (round
 *  ended first) falls back to the round's end tick. */
function buildSmokeLives(
  detonateEvents: SmokeEventRow[],
  expireEvents: SmokeEventRow[],
  context: MatchContext,
): SmokeLife[] {
  const expireByKey = new Map<string, number>();
  for (const e of expireEvents) {
    const round = e.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;
    expireByKey.set(`${round}::${e.entityid}`, e.tick);
  }

  const roundEndTick = new Map<number, number>();
  for (const r of context.rounds) roundEndTick.set(r.roundNumber, r.endTick);

  const lives: SmokeLife[] = [];
  for (const d of detonateEvents) {
    const round = d.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;
    const thrower = d.user_steamid;
    if (!thrower) continue;
    const endTick = expireByKey.get(`${round}::${d.entityid}`) ?? roundEndTick.get(round) ?? d.tick;
    lives.push({ round, thrower, x: d.x, y: d.y, startTick: d.tick, endTick: Math.max(d.tick, endTick) });
  }
  return lives;
}

function sampleTicksForLife(life: SmokeLife, intervalTicks: number): number[] {
  const ticks: number[] = [];
  for (let t = life.startTick; t <= life.endTick; t += intervalTicks) ticks.push(t);
  ticks.push(life.endTick);
  return ticks;
}

/** Tick list demoOrchestrator.ts needs to fetch (via parseTicks, all players) for
 *  collectSmokes: sampled ticks across each smoke's life. */
export function neededSmokeTicks(
  detonateEvents: SmokeEventRow[],
  expireEvents: SmokeEventRow[],
  context: MatchContext,
): number[] {
  const lives = buildSmokeLives(detonateEvents, expireEvents, context);
  const intervalTicks = Math.round(SAMPLE_INTERVAL_SECONDS * context.tickRate);
  const ticks = new Set<number>();
  for (const life of lives) {
    for (const t of sampleTicksForLife(life, intervalTicks)) ticks.add(t);
  }
  return [...ticks];
}

/**
 * Smokes interfering with pushes (#173 phase 3.5): a smoke counts as "blocking" if an enemy of
 * the thrower came within SMOKE_BLOCK_RADIUS of its detonation position at any sampled tick
 * during its life. Position-based, not a true visibility/render check — see the issue for why
 * that's out of scope. CT-only, matching Leetify's own "[CT] Smokes That Stopped a Push" — a
 * T-side smoke is a different tactical use (covering a bomb plant/retake, not stopping a push)
 * and isn't counted toward either this or `ct_smokes_thrown`.
 */
export function collectSmokes(
  detonateEvents: SmokeEventRow[],
  expireEvents: SmokeEventRow[],
  positionRows: PlayerPositionRow[],
  context: MatchContext,
  steamIds: string[],
): CollectorOut {
  const out: CollectorOut = new Map();
  const steamSet = new Set(steamIds);
  for (const sid of steamIds) out.set(sid, {});

  const positionsByTick = new Map<number, PlayerPositionRow[]>();
  for (const p of positionRows) {
    if (!positionsByTick.has(p.tick)) positionsByTick.set(p.tick, []);
    positionsByTick.get(p.tick)!.push(p);
  }

  const lives = buildSmokeLives(detonateEvents, expireEvents, context);
  const intervalTicks = Math.round(SAMPLE_INTERVAL_SECONDS * context.tickRate);

  for (const life of lives) {
    if (!steamSet.has(life.thrower)) continue;
    const throwerSide = context.playerSides.get(life.thrower)?.get(life.round);
    if (throwerSide !== 'CT') continue;

    const p = out.get(life.thrower)!;
    p.ct_smokes_thrown = ((p.ct_smokes_thrown as number) ?? 0) + 1;

    let blocked = false;
    for (const t of sampleTicksForLife(life, intervalTicks)) {
      if (blocked) break;
      const rows = positionsByTick.get(t) ?? [];
      for (const row of rows) {
        if (row.steamid === life.thrower || !steamSet.has(row.steamid)) continue;
        const side = context.playerSides.get(row.steamid)?.get(life.round);
        const isEnemy = throwerSide != null && side != null && throwerSide !== side;
        if (!isEnemy) continue;
        const dx = row.x - life.x;
        const dy = row.y - life.y;
        if (Math.sqrt(dx * dx + dy * dy) <= SMOKE_BLOCK_RADIUS) {
          blocked = true;
          break;
        }
      }
    }

    if (blocked) {
      p.smokes_blocking_push = ((p.smokes_blocking_push as number) ?? 0) + 1;
    }
  }

  return out;
}
