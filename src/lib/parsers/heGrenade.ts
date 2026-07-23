import type { SabFields } from '../types';
import { isTeamKill, type MatchContext, type PlayerHurtRow } from './matchContext';
import type { WeaponFireRow } from './utility';

type CollectorOut = Map<string, Partial<SabFields>>;

// weapon_fire reports the weapon entity classname (weapon_hegrenade), but player_hurt reports
// CS2's short game-event weapon name (hegrenade) — the two events use different naming for the
// same weapon, matching how utility.ts's flashbang handling already differs by event type.
const HE_FIRE_WEAPON = 'weapon_hegrenade';
const HE_HURT_WEAPON = 'hegrenade';

/**
 * HE grenade throws and enemy damage dealt (#173 phase 2.1). Damage to teammates/self isn't
 * credited, matching the enemy-only intent of the existing utility_damage accumulator.
 */
export function collectHeGrenades(
  fireEvents: WeaponFireRow[],
  hurtEvents: PlayerHurtRow[],
  context: MatchContext,
  steamIds: string[],
): CollectorOut {
  const out: CollectorOut = new Map();
  const steamSet = new Set(steamIds);
  for (const sid of steamIds) out.set(sid, {});

  for (const f of fireEvents) {
    if (f.weapon !== HE_FIRE_WEAPON) continue;
    const round = f.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;
    const thrower = f.user_steamid;
    if (!thrower || !steamSet.has(thrower)) continue;
    const p = out.get(thrower)!;
    p.he_thrown = ((p.he_thrown as number) ?? 0) + 1;
  }

  for (const h of hurtEvents) {
    if (h.weapon !== HE_HURT_WEAPON) continue;
    const round = h.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;

    const attacker = h.attacker_steamid;
    const victim = h.user_steamid;
    if (!attacker || !steamSet.has(attacker)) continue;
    if (!victim || !steamSet.has(victim)) continue;
    if (attacker === victim) continue; // self-damage isn't credited

    if (isTeamKill(attacker, victim, context)) continue; // teamdamage isn't credited

    const p = out.get(attacker)!;
    p.he_damage = ((p.he_damage as number) ?? 0) + (h.dmg_health ?? 0);
  }

  return out;
}
