import type { SabFields } from '../types';
import type { MatchContext, PlayerHurtRow } from './matchContext';
import type { WeaponFireRow } from './utility';

type CollectorOut = Map<string, Partial<SabFields>>;

// weapon_fire's classnames for grenades/equipment — excluded so "shots" means gunfire only.
const NON_GUN_FIRE_WEAPONS = new Set([
  'weapon_hegrenade', 'weapon_flashbang', 'weapon_smokegrenade', 'weapon_molotov',
  'weapon_incgrenade', 'weapon_decoy', 'weapon_knife', 'weapon_knifegg', 'weapon_c4',
]);

// player_hurt's short weapon names for the same non-gun sources (confirmed unprefixed-friendly
// format against a real DGLS demo, e.g. 'hkp2000', 'glock' for guns). Fire damage (molotov/
// incendiary) is conventionally reported as 'inferno' rather than the grenade's own name.
const NON_GUN_HURT_WEAPONS = new Set([
  'hegrenade', 'flashbang', 'inferno', 'decoy', 'knife', 'knifegg', 'c4',
]);

// player_hurt's hitgroup is already decoded to a friendly string ('head', 'chest',
// 'right_arm', ...), not the raw HITGROUP_* enum int — confirmed against a real DGLS demo.
const HITGROUP_HEAD = 'head';

// Assumed short weapon name for the AWP, following the same unprefixed convention as
// NON_GUN_HURT_WEAPONS (e.g. 'ak47', 'hkp2000') — not yet confirmed against a real DGLS demo with
// an AWP kill, unlike those. Leetify's Headshot Accuracy excludes AWP shots entirely (both from
// the headshot count and from its own hit denominator); general Accuracy/shots_hit still include
// the AWP, since Leetify only carves it out of the head-accuracy stat specifically.
const AWP_HURT_WEAPON = 'awp';

/**
 * Raw accuracy / head accuracy (#173 phase 3.3). "Raw" because it isn't gated on the enemy
 * having been spotted — see docs/calculations.md for why that gate isn't implemented.
 */
export function collectAccuracy(
  fireEvents: WeaponFireRow[],
  hurtEvents: PlayerHurtRow[],
  context: MatchContext,
  steamIds: string[],
): CollectorOut {
  const out: CollectorOut = new Map();
  const steamSet = new Set(steamIds);
  for (const sid of steamIds) out.set(sid, {});

  for (const f of fireEvents) {
    if (NON_GUN_FIRE_WEAPONS.has(f.weapon)) continue;
    const round = f.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;
    const shooter = f.user_steamid;
    if (!shooter || !steamSet.has(shooter)) continue;
    const p = out.get(shooter)!;
    p.shots_fired = ((p.shots_fired as number) ?? 0) + 1;
  }

  for (const h of hurtEvents) {
    if (NON_GUN_HURT_WEAPONS.has(h.weapon)) continue;
    const round = h.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;

    const attacker = h.attacker_steamid;
    const victim = h.user_steamid;
    if (!attacker || !steamSet.has(attacker)) continue;
    if (!victim || !steamSet.has(victim)) continue;
    if (attacker === victim) continue; // self-damage isn't credited

    const attackerSide = context.playerSides.get(attacker)?.get(round);
    const victimSide = context.playerSides.get(victim)?.get(round);
    const isEnemy = attackerSide != null && victimSide != null && attackerSide !== victimSide;
    if (!isEnemy) continue; // teamdamage isn't credited

    const p = out.get(attacker)!;
    p.shots_hit = ((p.shots_hit as number) ?? 0) + 1;
    if (h.hitgroup === HITGROUP_HEAD) {
      p.headshot_hits = ((p.headshot_hits as number) ?? 0) + 1;
    }
    if (h.weapon !== AWP_HURT_WEAPON) {
      p.shots_hit_no_awp = ((p.shots_hit_no_awp as number) ?? 0) + 1;
      if (h.hitgroup === HITGROUP_HEAD) {
        p.headshot_hits_no_awp = ((p.headshot_hits_no_awp as number) ?? 0) + 1;
      }
    }
  }

  return out;
}
