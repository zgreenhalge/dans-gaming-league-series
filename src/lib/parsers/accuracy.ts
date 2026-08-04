import type { SabFields } from '../types';
import { isTeamKill, type MatchContext, type PlayerHurtRow } from './matchContext';
import type { WeaponFireRow } from './utility';
import { HITGROUP_HEAD } from './constants';
import { WEAPON_CATEGORY, stripWeaponPrefix } from './weaponClasses';
import { initCollector, roundOf } from './_shared';

type CollectorOut = Map<string, Partial<SabFields>>;

// Assumed short weapon name for the AWP, following the same unprefixed convention WEAPON_CATEGORY
// is keyed by (e.g. 'ak47', 'hkp2000') — not yet confirmed against a real DGLS demo with an AWP
// kill, unlike the rest of that map. Leetify's Headshot Accuracy excludes AWP shots entirely (both
// from the headshot count and from its own hit denominator); general Accuracy/shots_hit still
// include the AWP, since Leetify only carves it out of the head-accuracy stat specifically.
const AWP_HURT_WEAPON = 'awp';

/**
 * Raw accuracy / head accuracy (#173 phase 3.3). "Raw" because it isn't gated on the enemy
 * having been spotted — see docs/calculations.md for why that gate isn't implemented.
 *
 * "Shots" means gunfire only: both fire and hurt events are gated on membership in
 * WEAPON_CATEGORY, an allowlist of the CS2 gun roster, so grenades/C4/knives (including knife
 * skins, which each get their own weapon_fire classname) fall through with no exclusion list to
 * maintain.
 */
export function collectAccuracy(
  fireEvents: WeaponFireRow[],
  hurtEvents: PlayerHurtRow[],
  context: MatchContext,
  steamIds: string[],
): CollectorOut {
  const { out, steamSet } = initCollector<SabFields>(steamIds);

  for (const f of fireEvents) {
    if (!WEAPON_CATEGORY[stripWeaponPrefix(f.weapon)]) continue;
    if (roundOf(f, context.liveRounds) == null) continue;
    const shooter = f.user_steamid;
    if (!shooter || !steamSet.has(shooter)) continue;
    const p = out.get(shooter)!;
    p.shots_fired = ((p.shots_fired as number) ?? 0) + 1;
  }

  for (const h of hurtEvents) {
    if (!WEAPON_CATEGORY[h.weapon]) continue;
    if (roundOf(h, context.liveRounds) == null) continue;

    const attacker = h.attacker_steamid;
    const victim = h.user_steamid;
    if (!attacker || !steamSet.has(attacker)) continue;
    if (!victim || !steamSet.has(victim)) continue;
    if (attacker === victim) continue; // self-damage isn't credited

    if (isTeamKill(attacker, victim, context)) continue; // teamdamage isn't credited

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
