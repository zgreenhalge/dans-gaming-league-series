import type { SabFields } from '../types';
import { isTeamKill, type MatchContext, type PlayerHurtRow } from './matchContext';
import { HITGROUP_HEAD } from './constants';
import { WEAPON_CATEGORY } from './weaponClasses';
import { initCollector, roundOf } from './_shared';

type CollectorOut = Map<string, Partial<SabFields>>;

// Assumed short weapon name for the AWP, following the same unprefixed convention WEAPON_CATEGORY
// is keyed by (e.g. 'ak47', 'hkp2000') — not yet confirmed against a real DGLS demo with an AWP
// kill, unlike the rest of that map. Leetify's Headshot Accuracy excludes AWP shots entirely (both
// from the headshot count and from its own hit denominator); general Accuracy/shots_hit still
// include the AWP, since Leetify only carves it out of the head-accuracy stat specifically.
const AWP_HURT_WEAPON = 'awp';

/**
 * AWP-excluded head accuracy (#173 phase 3.3) — the one accuracy breakdown with no cheaper
 * source: `player_match_weapon_stats`'s per-category buckets can't isolate the AWP from the rest of
 * the "sniper" category, so this stays a dedicated collector even though the plain
 * `shots_fired`/`shots_hit`/`headshot_hits` totals (once computed here too) are now derived at
 * query time from `player_match_weapon_stats` instead (`deriveAccuracyTotals()` in
 * `queries/weaponStats.ts` — both are the identical `WEAPON_CATEGORY`-gated, self-kill/teamkill
 * excluded event set, just one buckets by category and this used to sum flat). "Raw" because it
 * isn't gated on the enemy having been spotted — see docs/calculations.md for why that gate isn't
 * implemented.
 */
export function collectAccuracy(
  hurtEvents: PlayerHurtRow[],
  context: MatchContext,
  steamIds: string[],
): CollectorOut {
  const { out, steamSet } = initCollector<SabFields>(steamIds);

  for (const h of hurtEvents) {
    if (!WEAPON_CATEGORY[h.weapon]) continue;
    if (roundOf(h, context) == null) continue;
    if (h.weapon === AWP_HURT_WEAPON) continue;

    const attacker = h.attacker_steamid;
    const victim = h.user_steamid;
    if (!attacker || !steamSet.has(attacker)) continue;
    if (!victim || !steamSet.has(victim)) continue;
    if (attacker === victim) continue; // self-damage isn't credited

    if (isTeamKill(attacker, victim, context)) continue; // teamdamage isn't credited

    const p = out.get(attacker)!;
    p.shots_hit_no_awp = ((p.shots_hit_no_awp as number) ?? 0) + 1;
    if (h.hitgroup === HITGROUP_HEAD) {
      p.headshot_hits_no_awp = ((p.headshot_hits_no_awp as number) ?? 0) + 1;
    }
  }

  return out;
}
