import type { SabFields } from '../types';
import type { MatchContext } from './matchContext';
import type { WeaponFireRow } from './utility';

type CollectorOut = Map<string, Partial<SabFields>>;

// Rifles only, per #173 phase 3.1 — pistols/SMGs/snipers/shotguns are excluded.
export const RIFLE_WEAPONS = new Set([
  'weapon_ak47', 'weapon_m4a1', 'weapon_m4a1_silencer',
  'weapon_famas', 'weapon_galilar', 'weapon_sg556', 'weapon_aug',
]);

// "Good" = moving at less than this fraction of the weapon's max speed at fire time.
const COUNTER_STRAFE_SPEED_FRACTION = 0.34;

// Ticks back from the fire tick used to measure a position delta for instantaneous speed.
// Confirmed against a real demo that this parser exposes no direct velocity read
// (velocity/velocity_X/Y/Z all come back null) but does expose per-tick X/Y position, so
// speed is derived from a 1-tick position delta instead.
const SPEED_TICK_WINDOW = 1;

export interface PlayerTickRow {
  tick: number;
  steamid: string;
  ducked: boolean;
  maxSpeed: number;
  x: number;
  y: number;
}

/** Tick list demoOrchestrator.ts needs to fetch (via parseTicks) for collectCounterStrafe:
 *  each qualifying rifle fire's own tick plus SPEED_TICK_WINDOW ticks earlier. */
export function neededCounterStrafeTicks(fireEvents: WeaponFireRow[], liveRounds: Set<number>): number[] {
  const ticks = new Set<number>();
  for (const f of fireEvents) {
    if (!RIFLE_WEAPONS.has(f.weapon)) continue;
    if (!liveRounds.has(f.total_rounds_played + 1)) continue;
    ticks.add(f.tick);
    ticks.add(f.tick - SPEED_TICK_WINDOW);
  }
  return [...ticks];
}

export function collectCounterStrafe(
  fireEvents: WeaponFireRow[],
  tickRows: PlayerTickRow[],
  context: MatchContext,
  steamIds: string[],
): CollectorOut {
  const out: CollectorOut = new Map();
  const steamSet = new Set(steamIds);
  for (const sid of steamIds) out.set(sid, {});

  const rowLookup = new Map<string, PlayerTickRow>();
  for (const r of tickRows) rowLookup.set(`${r.steamid}::${r.tick}`, r);

  for (const f of fireEvents) {
    if (!RIFLE_WEAPONS.has(f.weapon)) continue;
    const round = f.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;
    const shooter = f.user_steamid;
    if (!shooter || !steamSet.has(shooter)) continue;

    const atFire = rowLookup.get(`${shooter}::${f.tick}`);
    if (!atFire) continue;
    if (atFire.ducked) continue; // crouched shots are excluded entirely, not just "not good"

    const p = out.get(shooter)!;
    p.counter_strafe_shots = ((p.counter_strafe_shots as number) ?? 0) + 1;

    const before = rowLookup.get(`${shooter}::${f.tick - SPEED_TICK_WINDOW}`);
    if (!before || atFire.maxSpeed <= 0) continue;

    const dx = atFire.x - before.x;
    const dy = atFire.y - before.y;
    const dt = SPEED_TICK_WINDOW / context.tickRate;
    const speed = Math.sqrt(dx * dx + dy * dy) / dt;

    if (speed < COUNTER_STRAFE_SPEED_FRACTION * atFire.maxSpeed) {
      p.counter_strafe_good_shots = ((p.counter_strafe_good_shots as number) ?? 0) + 1;
    }
  }

  return out;
}
