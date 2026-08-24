import { supabase } from '../supabase';
import { resolveMatchSeasons, fetchAllPages, asPage } from './_shared';
import { getPlayersById } from './player';
import { killWeaponCategory, type KillWeaponCategory } from '../parsers/weaponClasses';
import type { Player } from '../types';

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

type PmsRow = { id: number; player_id: number; match_id: number };

function fetchPmsLookup(matchId?: number): Promise<Map<number, PmsRow>> {
  return fetchAllPages<PmsRow>((from, to) => {
    let q = supabase.from('player_match_stats').select('id, player_id, match_id');
    if (matchId != null) q = q.eq('match_id', matchId);
    return asPage(q.range(from, to));
  }).then((rows) => new Map(rows.map((r) => [r.id, r])));
}

/** Joins raw `match_kills` rows to player names and a per-match season, dropping any kill whose
 *  victim has no resolvable `player_match_stats` row. `seasonOf` returning `null` drops the kill
 *  entirely (used by `getAllMatchKills` to skip both an unresolvable season and a season-filter
 *  miss); `getMatchKills` (already scoped to one match) never drops on season. */
function joinKillRows(
  killRows: RawKillRow[],
  pmsLookup: Map<number, PmsRow>,
  playersById: Map<number, Player>,
  seasonOf: (matchId: number) => number | null,
): MatchKillRow[] {
  const result: MatchKillRow[] = [];
  for (const k of killRows) {
    const seasonId = seasonOf(k.match_id);
    if (seasonId == null) continue;

    const victimPms = pmsLookup.get(k.victim_player_match_stats_id);
    if (!victimPms) continue;
    const attackerPms =
      k.attacker_player_match_stats_id != null ? pmsLookup.get(k.attacker_player_match_stats_id) : undefined;
    const assisterPms =
      k.assister_player_match_stats_id != null ? pmsLookup.get(k.assister_player_match_stats_id) : undefined;

    result.push({
      match_id: k.match_id,
      season_id: seasonId,
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

/** One match's recorded kills, joined to player names — the match-page-scoped counterpart of
 *  `getAllMatchKills()` (avoids fetching every match's kills to render one box score). Pass
 *  `playersById` when the caller already fetched it (every current caller does) to skip a
 *  redundant full `players` table read. */
export async function getMatchKills(
  matchId: number,
  playersById?: Map<number, Player> | Promise<Map<number, Player>>,
): Promise<MatchKillRow[]> {
  const [killRows, pmsLookup, resolvedPlayersById] = await Promise.all([
    fetchAllPages<RawKillRow>((from, to) =>
      supabase.from('match_kills').select('*').eq('match_id', matchId).range(from, to),
    ),
    fetchPmsLookup(matchId),
    playersById ? Promise.resolve(playersById) : getPlayersById(),
  ]);

  // Not resolved for a single-match fetch — callers here don't need it — so every kill is kept.
  return joinKillRows(killRows, pmsLookup, resolvedPlayersById, () => -1);
}

/** Every recorded kill (`match_kills`), joined to player names and season. Flat, ungrouped —
 *  callers filter/aggregate from here (kills-by-weapon, killed-by-weapon, favorite weapon, ...),
 *  matching this codebase's fetch-then-aggregate-in-TS query pattern (see `weaponStats.ts`). Pass
 *  `playersById` when the caller already fetched it to skip a redundant full `players` table read. */
export async function getAllMatchKills(
  seasonId?: number,
  playersById?: Map<number, Player> | Promise<Map<number, Player>>,
): Promise<MatchKillRow[]> {
  const [killRows, pmsLookup, matchSeason, resolvedPlayersById] = await Promise.all([
    fetchAllPages<RawKillRow>((from, to) => supabase.from('match_kills').select('*').range(from, to)),
    fetchPmsLookup(),
    resolveMatchSeasons(),
    playersById ? Promise.resolve(playersById) : getPlayersById(),
  ]);

  return joinKillRows(killRows, pmsLookup, resolvedPlayersById, (matchId) => {
    const sid = matchSeason.get(matchId);
    if (sid == null) return null;
    if (seasonId != null && sid !== seasonId) return null;
    return sid;
  });
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

/** Every distinct weapon with at least one credited kill (excludes self-kills/teamkills) across
 *  `kills`, sorted by total kill count descending — the option list for a "pick a specific weapon"
 *  filter (e.g. the Weapons sub-tab's weapon selector). */
export function allWeaponsWithKills(kills: MatchKillRow[]): string[] {
  const counts = new Map<string, number>();
  for (const k of kills) {
    if (k.attacker_player_id == null || k.attacker_player_id === k.victim_player_id || k.is_teamkill) continue;
    counts.set(k.weapon, (counts.get(k.weapon) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
}

/** Resolves which of a player's `WeaponKillStat[]` a "favorite vs specific weapon" filter should
 *  show: `weapon === null` picks their favorite (`favoriteWeapon()`); a specific weapon name looks
 *  it up, falling back to a zeroed stat (rather than `null`) when the player has no kills/deaths
 *  with it — so a specific-weapon selection always renders a row for every player, per the
 *  Weapons sub-tab's filter contract. */
export function resolveWeaponStat(stats: WeaponKillStat[], weapon: string | null): WeaponKillStat | null {
  if (weapon == null) return favoriteWeapon(stats);
  return (
    stats.find((s) => s.weapon === weapon) ??
    { weapon, category: killWeaponCategory(weapon), kills: 0, headshotKills: 0, deaths: 0 }
  );
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
