import type { SabFields } from '../types';
import { isTeamKill, type MatchContext, type PlayerHurtRow } from './matchContext';
import type { WeaponFireRow } from './utility';
import { RIFLE_WEAPONS } from './counterStrafe';

type CollectorOut = Map<string, Partial<SabFields>>;

// player_hurt's short weapon names for RIFLE_WEAPONS (unprefixed, confirmed convention —
// see accuracy.ts).
const RIFLE_HURT_WEAPONS = new Set([
  'ak47', 'm4a1', 'm4a1_silencer', 'famas', 'galilar', 'sg556', 'aug',
]);

// Consecutive same-weapon shots within this many seconds are one "spray"; a bigger gap starts a
// new sequence. Deliberately generous — separating held-trigger fire from deliberate taps
// doesn't need each rifle's exact cycle time, just a threshold well above any of them and well
// below a tap-fire gap.
const SPRAY_GAP_SECONDS = 0.25;

const MIN_SPRAY_SHOTS = 3;

/**
 * Spray accuracy (#173 phase 3.2): bullets hit / bullets fired within sequences of 3+
 * consecutive rifle shots from the same weapon. Reports the overall total, not a per-rifle
 * breakdown (that would need per-weapon columns or a child table — deferred).
 */
export function collectSprayAccuracy(
  fireEvents: WeaponFireRow[],
  hurtEvents: PlayerHurtRow[],
  context: MatchContext,
  steamIds: string[],
): CollectorOut {
  const out: CollectorOut = new Map();
  const steamSet = new Set(steamIds);
  for (const sid of steamIds) out.set(sid, {});

  const gapTicks = Math.round(SPRAY_GAP_SECONDS * context.tickRate);

  // Rifle fire ticks per (shooter, round, weapon) — never mixes weapons or rounds into one
  // sequence.
  const shotsByKey = new Map<string, number[]>();
  for (const f of fireEvents) {
    if (!RIFLE_WEAPONS.has(f.weapon)) continue;
    const round = f.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;
    const shooter = f.user_steamid;
    if (!shooter || !steamSet.has(shooter)) continue;
    const key = `${shooter}::${round}::${f.weapon}`;
    if (!shotsByKey.has(key)) shotsByKey.set(key, []);
    shotsByKey.get(key)!.push(f.tick);
  }

  // Enemy rifle-hit ticks per (attacker, round), for matching hits into a sequence's window.
  const hurtTicksByKey = new Map<string, number[]>();
  for (const h of hurtEvents) {
    if (!RIFLE_HURT_WEAPONS.has(h.weapon)) continue;
    const round = h.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;
    const attacker = h.attacker_steamid;
    const victim = h.user_steamid;
    if (!attacker || !steamSet.has(attacker)) continue;
    if (!victim || !steamSet.has(victim)) continue;
    if (attacker === victim) continue;
    if (isTeamKill(attacker, victim, context)) continue;
    const key = `${attacker}::${round}`;
    if (!hurtTicksByKey.has(key)) hurtTicksByKey.set(key, []);
    hurtTicksByKey.get(key)!.push(h.tick);
  }

  for (const [key, ticks] of shotsByKey) {
    const [shooter, round] = key.split('::');
    ticks.sort((a, b) => a - b);

    let seqStart = 0;
    for (let i = 1; i <= ticks.length; i++) {
      const sequenceBroke = i === ticks.length || ticks[i] - ticks[i - 1] > gapTicks;
      if (!sequenceBroke) continue;

      const seqLen = i - seqStart;
      if (seqLen >= MIN_SPRAY_SHOTS) {
        const seqStartTick = ticks[seqStart];
        const seqEndTick = ticks[i - 1];
        const p = out.get(shooter)!;
        p.spray_shots_fired = ((p.spray_shots_fired as number) ?? 0) + seqLen;

        const hurtTicks = hurtTicksByKey.get(`${shooter}::${round}`) ?? [];
        const hitsInSeq = hurtTicks.filter((t) => t >= seqStartTick && t <= seqEndTick).length;
        p.spray_shots_hit = ((p.spray_shots_hit as number) ?? 0) + hitsInSeq;
      }

      seqStart = i;
    }
  }

  return out;
}
