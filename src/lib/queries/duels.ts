import type { MatchKillRow } from './kills';
import type { MatchDamageEventRow } from './damage';
import { killWeaponCategory, KILL_WEAPON_CATEGORIES, type KillWeaponCategory } from '../parsers/weaponClasses';

/** One weapon category's kill split within a duel — only categories either side actually landed
 *  a kill in appear in `MatchDuelStat.weaponBreakdown`. Each array holds one entry per kill, in
 *  kill order, `true` when that kill was a headshot — a UI can render one visual "pip" per kill
 *  (à la Leetify's H2H) rather than just a count. */
export interface MatchDuelWeaponSplit {
  category: KillWeaponCategory;
  /** `aId`'s kills on `bId` in this category, oldest first. */
  aKills: boolean[];
  /** `bId`'s kills on `aId` in this category, oldest first. */
  bKills: boolean[];
}

/** One `aId`-vs-`bId` player pair's actual kill/damage exchange within a single match, straight
 *  from that match's killfeed and damage log — how many times each one killed the other, with
 *  what weapons, and how much damage each dealt the other. Not an aggregate multi-match rivalry
 *  score. Powers a match's own H2H tab (`MatchH2H.tsx`). */
export interface MatchDuelStat {
  aId: number;
  bId: number;
  /** `aId`'s kills on `bId`. */
  aKills: number;
  /** `bId`'s kills on `aId`. */
  bKills: number;
  /** Of `aKills`, how many were headshots. */
  aHeadshots: number;
  /** Of `bKills`, how many were headshots. */
  bHeadshots: number;
  /** Damage `aId` dealt `bId` (all sources — guns, utility, self/team damage excluded by
   *  construction since attacker/victim differ here). */
  aDamage: number;
  /** Damage `bId` dealt `aId`. */
  bDamage: number;
  /** Each weapon category either side got a kill with, ordered by `KILL_WEAPON_CATEGORIES`. */
  weaponBreakdown: MatchDuelWeaponSplit[];
}

/** Computes every `aIds[i]`-vs-`bIds[j]` pair's duel record from one match's killfeed and damage
 *  log — e.g. the 4 shirts-vs-skins matchups in a 2v2 Wingman match. Every combination is
 *  returned, even ones with zero kills either way (they never crossed paths) — callers render an
 *  empty state for those rather than this function guessing at one. */
export function computeMatchDuels(
  kills: MatchKillRow[],
  damageEvents: MatchDamageEventRow[],
  aIds: number[],
  bIds: number[],
): MatchDuelStat[] {
  // Sorted once (not per pair) so weaponBreakdown's kill order reflects when each kill actually
  // happened, not the order match_kills rows happened to come back in.
  const orderedKills = [...kills].sort((x, y) => x.round_number - y.round_number || x.tick - y.tick);

  return aIds.flatMap((aId) =>
    bIds.map((bId) => {
      let aKills = 0, bKills = 0, aHeadshots = 0, bHeadshots = 0;
      const byCategory = new Map<KillWeaponCategory, { aKills: boolean[]; bKills: boolean[] }>();
      const recordKill = (weapon: string, headshot: boolean, side: 'aKills' | 'bKills') => {
        const category = killWeaponCategory(weapon);
        const split = byCategory.get(category) ?? { aKills: [], bKills: [] };
        split[side].push(headshot);
        byCategory.set(category, split);
      };
      for (const k of orderedKills) {
        if (k.attacker_player_id === aId && k.victim_player_id === bId) {
          aKills++;
          if (k.headshot) aHeadshots++;
          recordKill(k.weapon, k.headshot, 'aKills');
        } else if (k.attacker_player_id === bId && k.victim_player_id === aId) {
          bKills++;
          if (k.headshot) bHeadshots++;
          recordKill(k.weapon, k.headshot, 'bKills');
        }
      }

      let aDamage = 0, bDamage = 0;
      for (const d of damageEvents) {
        if (d.attacker_player_id === aId && d.victim_player_id === bId) aDamage += d.damage;
        else if (d.attacker_player_id === bId && d.victim_player_id === aId) bDamage += d.damage;
      }

      const weaponBreakdown = KILL_WEAPON_CATEGORIES
        .map((category) => ({ category, ...(byCategory.get(category) ?? { aKills: [], bKills: [] }) }))
        .filter((split) => split.aKills.length > 0 || split.bKills.length > 0);

      return { aId, bId, aKills, bKills, aHeadshots, bHeadshots, aDamage, bDamage, weaponBreakdown };
    }),
  );
}
