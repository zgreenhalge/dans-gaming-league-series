import { supabase } from '../supabase';
import { resolveMatchSeasons, fetchAllPages, asPage } from './_shared';
import { getPlayersById } from './player';
import { killWeaponCategory, type KillWeaponCategory } from '../parsers/weaponClasses';

export interface MatchKillRow {
  match_id: number;
  season_id: number;
  round_number: number;
  attacker_player_id: number | null;
  attacker_name: string | null;
  victim_player_id: number;
  victim_name: string;
  assister_player_id: number | null;
  weapon: string;
  headshot: boolean;
  is_teamkill: boolean;
}

type RawKillRow = {
  match_id: number;
  round_number: number;
  attacker_player_match_stats_id: number | null;
  victim_player_match_stats_id: number;
  assister_player_match_stats_id: number | null;
  weapon: string;
  headshot: boolean;
  is_teamkill: boolean;
};

/** One match's recorded kills, joined to player names — the match-page-scoped counterpart of
 *  `getAllMatchKills()` (avoids fetching every match's kills to render one box score). */
export async function getMatchKills(matchId: number): Promise<MatchKillRow[]> {
  const [killRows, pmsRows, playersById] = await Promise.all([
    fetchAllPages<RawKillRow>((from, to) =>
      supabase.from('match_kills').select('*').eq('match_id', matchId).range(from, to),
    ),
    fetchAllPages<{ id: number; player_id: number; match_id: number }>((from, to) =>
      asPage(supabase.from('player_match_stats').select('id, player_id, match_id').eq('match_id', matchId).range(from, to)),
    ),
    getPlayersById(),
  ]);

  const pmsLookup = new Map<number, { player_id: number; match_id: number }>();
  for (const r of pmsRows) pmsLookup.set(r.id, r);

  const result: MatchKillRow[] = [];
  for (const k of killRows) {
    const victimPms = pmsLookup.get(k.victim_player_match_stats_id);
    if (!victimPms) continue;
    const attackerPms =
      k.attacker_player_match_stats_id != null ? pmsLookup.get(k.attacker_player_match_stats_id) : undefined;
    const assisterPms =
      k.assister_player_match_stats_id != null ? pmsLookup.get(k.assister_player_match_stats_id) : undefined;

    result.push({
      match_id: k.match_id,
      season_id: -1, // not resolved for a single-match fetch — callers here don't need it
      round_number: k.round_number,
      attacker_player_id: attackerPms?.player_id ?? null,
      attacker_name: attackerPms ? (playersById.get(attackerPms.player_id)?.name ?? `#${attackerPms.player_id}`) : null,
      victim_player_id: victimPms.player_id,
      victim_name: playersById.get(victimPms.player_id)?.name ?? `#${victimPms.player_id}`,
      assister_player_id: assisterPms?.player_id ?? null,
      weapon: k.weapon,
      headshot: k.headshot,
      is_teamkill: k.is_teamkill,
    });
  }
  return result;
}

/** Every recorded kill (`match_kills`), joined to player names and season. Flat, ungrouped —
 *  callers filter/aggregate from here (kills-by-weapon, killed-by-weapon, favorite weapon, ...),
 *  matching this codebase's fetch-then-aggregate-in-TS query pattern (see `weaponStats.ts`). */
export async function getAllMatchKills(seasonId?: number): Promise<MatchKillRow[]> {
  const [killRows, pmsRows, matchSeason, playersById] = await Promise.all([
    fetchAllPages<RawKillRow>((from, to) => supabase.from('match_kills').select('*').range(from, to)),
    fetchAllPages<{ id: number; player_id: number; match_id: number }>((from, to) =>
      asPage(supabase.from('player_match_stats').select('id, player_id, match_id').range(from, to)),
    ),
    resolveMatchSeasons(),
    getPlayersById(),
  ]);

  const pmsLookup = new Map<number, { player_id: number; match_id: number }>();
  for (const r of pmsRows) pmsLookup.set(r.id, r);

  const result: MatchKillRow[] = [];
  for (const k of killRows) {
    const sid = matchSeason.get(k.match_id);
    if (sid == null) continue;
    if (seasonId != null && sid !== seasonId) continue;

    const victimPms = pmsLookup.get(k.victim_player_match_stats_id);
    if (!victimPms) continue;
    const attackerPms =
      k.attacker_player_match_stats_id != null ? pmsLookup.get(k.attacker_player_match_stats_id) : undefined;
    const assisterPms =
      k.assister_player_match_stats_id != null ? pmsLookup.get(k.assister_player_match_stats_id) : undefined;

    result.push({
      match_id: k.match_id,
      season_id: sid,
      round_number: k.round_number,
      attacker_player_id: attackerPms?.player_id ?? null,
      attacker_name: attackerPms ? (playersById.get(attackerPms.player_id)?.name ?? `#${attackerPms.player_id}`) : null,
      victim_player_id: victimPms.player_id,
      victim_name: playersById.get(victimPms.player_id)?.name ?? `#${victimPms.player_id}`,
      assister_player_id: assisterPms?.player_id ?? null,
      weapon: k.weapon,
      headshot: k.headshot,
      is_teamkill: k.is_teamkill,
    });
  }
  return result;
}

export interface WeaponKillStat {
  weapon: string;
  category: KillWeaponCategory;
  kills: number;
  headshotKills: number;
  deaths: number;
}

/** Kills-with / headshot-kills-with / deaths-to, bucketed by individual weapon, for one player
 *  over whatever `kills` scope the caller already filtered (a season, a match, career). Self-kills
 *  and teamkills don't count toward `kills`/`headshotKills` (they're not a credited kill) but do
 *  still count as a death for the victim side. */
export function aggregateWeaponKillStats(kills: MatchKillRow[], playerId: number): WeaponKillStat[] {
  const buckets = new Map<string, WeaponKillStat>();
  const getBucket = (weapon: string): WeaponKillStat => {
    let b = buckets.get(weapon);
    if (!b) {
      b = { weapon, category: killWeaponCategory(weapon), kills: 0, headshotKills: 0, deaths: 0 };
      buckets.set(weapon, b);
    }
    return b;
  };

  for (const k of kills) {
    const isCreditedKill =
      k.attacker_player_id === playerId && k.attacker_player_id !== k.victim_player_id && !k.is_teamkill;
    if (isCreditedKill) {
      const b = getBucket(k.weapon);
      b.kills += 1;
      if (k.headshot) b.headshotKills += 1;
    }
    if (k.victim_player_id === playerId) {
      getBucket(k.weapon).deaths += 1;
    }
  }

  return [...buckets.values()].sort((a, b) => b.kills - a.kills);
}

/** The weapon a player has the most kills with, or `null` when they have none in scope. */
export function favoriteWeapon(stats: WeaponKillStat[]): WeaponKillStat | null {
  return stats.reduce<WeaponKillStat | null>((best, s) => (!best || s.kills > best.kills ? s : best), null);
}

export interface WeaponCategoryKillStat {
  category: KillWeaponCategory;
  kills: number;
  headshotKills: number;
  deaths: number;
}

/** Rolls `WeaponKillStat[]` up into category totals, reusing each weapon's already-resolved
 *  `killWeaponCategory()` bucket rather than reclassifying. */
export function aggregateKillCategoryStats(stats: WeaponKillStat[]): WeaponCategoryKillStat[] {
  const buckets = new Map<KillWeaponCategory, WeaponCategoryKillStat>();
  for (const s of stats) {
    let b = buckets.get(s.category);
    if (!b) {
      b = { category: s.category, kills: 0, headshotKills: 0, deaths: 0 };
      buckets.set(s.category, b);
    }
    b.kills += s.kills;
    b.headshotKills += s.headshotKills;
    b.deaths += s.deaths;
  }
  return [...buckets.values()].sort((a, b) => b.kills - a.kills);
}
