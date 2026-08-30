import { supabase } from '../supabase';
import {
  resolveMatchSeasons, fetchAllPages, fetchPmsLookup, bumpCounter, type PmsRow,
  buildPlayerFactionsAndRoster, type PlayerFactionsAndRoster, type RoundSideInfo,
} from './_shared';
import { getPlayersById } from './player';
import {
  killWeaponCategory, weaponGroupKey, weaponDisplayName, isGunWeapon, KILL_WEAPON_CATEGORY_LABEL,
  WEAPON_CATEGORIES, WORLD_DEATH_WEAPON, PLANTED_C4_DEATH_WEAPON,
  type KillWeaponCategory, type WeaponCategory,
} from '../parsers/weaponClasses';
import type { Player, Faction, RoundCondition } from '../types';
import type { AccuracyTotals, PlayerWeaponAccuracy, WeaponClassAggregateStat } from './weaponStats';
import { ZERO_WEAPON_CLASS_STAT } from './weaponStats';
import { resolveSide } from '../parsers/roundSides';
import { ZERO_UTILITY, type UtilityCounts } from './utility';

export { buildPlayerFactionsAndRoster, type PlayerFactionsAndRoster };

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
  noscope: boolean;
  wallbang: boolean;
  blind_kill: boolean;
  midair: boolean;
  is_teamkill: boolean;
  tick: number;
}

type RawKillRow = {
  match_id: number;
  round_number: number;
  attacker_player_match_stats_id: number | null;
  victim_player_match_stats_id: number;
  assister_player_match_stats_id: number | null;
  weapon: string;
  headshot: boolean;
  noscope: boolean;
  wallbang: boolean;
  blind_kill: boolean;
  midair: boolean;
  is_teamkill: boolean;
  tick: number;
};

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
      noscope: k.noscope,
      wallbang: k.wallbang,
      blind_kill: k.blind_kill,
      midair: k.midair,
      is_teamkill: k.is_teamkill,
      tick: k.tick,
    });
  }
  return result;
}

/** One match's recorded kills, joined to player names — the match-page-scoped counterpart of
 *  `getAllMatchKills()` (avoids fetching every match's kills to render one box score). Pass
 *  `playersById` when the caller already fetched it to skip a redundant full `players` table
 *  read — `getPlayersById()` is itself `cache()`-wrapped (#507), so omitting it still collapses
 *  to one read per render pass alongside any sibling caller. */
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
 *  `playersById` when the caller already fetched it to skip a redundant full `players` table read;
 *  likewise `pmsRows` for an already-fetched `player_match_stats` read. */
export async function getAllMatchKills(
  seasonId?: number,
  playersById?: Map<number, Player> | Promise<Map<number, Player>>,
  pmsRows?: PmsRow[] | Promise<PmsRow[]>,
): Promise<MatchKillRow[]> {
  const [killRows, pmsLookup, matchSeason, resolvedPlayersById] = await Promise.all([
    fetchAllPages<RawKillRow>((from, to) => supabase.from('match_kills').select('*').range(from, to)),
    fetchPmsLookup(undefined, pmsRows),
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

/** Every recorded kill (`match_kills`), resolved to `player_id`s only — no season filter, no name
 *  join. The `deriveKillCreditCounts()` family (headshot/opening-duel/two-K credit) reads nothing
 *  but `KillCreditFlags`'s fields, so callers deriving those (`getAllSabremetrics()`) don't need
 *  `getAllMatchKills()`'s heavier season resolution (a `matches`/`weeks` read) or per-kill name
 *  lookup. Pass `pmsRows` when the caller already fetched `player_match_stats` to skip a redundant
 *  full-table fetch. */
export async function getAllKillCreditFlags(
  pmsRows?: PmsRow[] | Promise<PmsRow[]>,
): Promise<KillCreditFlags[]> {
  const [killRows, pmsLookup] = await Promise.all([
    fetchAllPages<RawKillRow>((from, to) => supabase.from('match_kills').select('*').range(from, to)),
    fetchPmsLookup(undefined, pmsRows),
  ]);

  const out: KillCreditFlags[] = [];
  for (const k of killRows) {
    const victimPms = pmsLookup.get(k.victim_player_match_stats_id);
    if (!victimPms) continue;
    const attackerPms =
      k.attacker_player_match_stats_id != null ? pmsLookup.get(k.attacker_player_match_stats_id) : undefined;
    const assisterPms =
      k.assister_player_match_stats_id != null ? pmsLookup.get(k.assister_player_match_stats_id) : undefined;
    out.push({
      match_id: k.match_id,
      round_number: k.round_number,
      tick: k.tick,
      attacker_player_id: attackerPms?.player_id ?? null,
      victim_player_id: victimPms.player_id,
      assister_player_id: assisterPms?.player_id ?? null,
      headshot: k.headshot,
      is_teamkill: k.is_teamkill,
    });
  }
  return out;
}

export interface WeaponKillStat {
  weapon: string;
  category: KillWeaponCategory;
  kills: number;
  headshotKills: number;
  noscopeKills: number;
  wallbangKills: number;
  blindKills: number;
  midairKills: number;
  deaths: number;
}

/** A `WeaponKillStat` with every count at zero — the shape a weapon starts at before any kill/death
 *  is tallied into it (`aggregateWeaponKillStats()`), and the same shape `resolveWeaponStat()`
 *  falls back to for a weapon with no kills/deaths in scope, so both call sites build one from the
 *  same place instead of duplicating the field list. `weapon` is expected already grouped via
 *  `weaponGroupKey()` — this doesn't re-group it. */
function zeroWeaponStat(weapon: string): WeaponKillStat {
  return {
    weapon,
    category: killWeaponCategory(weapon),
    kills: 0,
    headshotKills: 0,
    noscopeKills: 0,
    wallbangKills: 0,
    blindKills: 0,
    midairKills: 0,
    deaths: 0,
  };
}

/** Kills-with / headshot-kills-with / deaths-to, bucketed by weapon, for every player with a kill or
 *  death in `kills` — the Weapons sub-tab's multi-player table (`WeaponsTable`,
 *  `SabremetricsLeaderboardView.tsx`) calls this once per render and looks each row up in O(1),
 *  rather than rescanning `kills` once per player (#502); `aggregateWeaponKillStats()` below is a
 *  one-player lookup on this same grouping, so there's one accumulation pass, not two. Bucketed by
 *  `weaponGroupKey()`, not the raw `match_kills.weapon` string, so every knife/bayonet skin variant
 *  merges into one `knife` row rather than splitting across cosmetic skin names (#474). Self-kills
 *  and teamkills don't count toward `kills`/`headshotKills`/`noscopeKills`/`wallbangKills`/
 *  `blindKills`/`midairKills` (they're not a credited kill) but do still count as a death for the
 *  victim side. A player with no kills/deaths in scope is simply absent from the map. */
export function groupWeaponKillStatsByPlayer(kills: MatchKillRow[]): Map<number, WeaponKillStat[]> {
  const byPlayer = new Map<number, Map<string, WeaponKillStat>>();
  const getBucket = (playerId: number, weapon: string): WeaponKillStat => {
    let buckets = byPlayer.get(playerId);
    if (!buckets) {
      buckets = new Map();
      byPlayer.set(playerId, buckets);
    }
    const key = weaponGroupKey(weapon);
    let b = buckets.get(key);
    if (!b) {
      b = zeroWeaponStat(key);
      buckets.set(key, b);
    }
    return b;
  };

  for (const k of kills) {
    const isCreditedKill =
      k.attacker_player_id != null && k.attacker_player_id !== k.victim_player_id && !k.is_teamkill;
    if (isCreditedKill) {
      const b = getBucket(k.attacker_player_id as number, k.weapon);
      b.kills += 1;
      if (k.headshot) b.headshotKills += 1;
      if (k.noscope) b.noscopeKills += 1;
      if (k.wallbang) b.wallbangKills += 1;
      if (k.blind_kill) b.blindKills += 1;
      if (k.midair) b.midairKills += 1;
    }
    getBucket(k.victim_player_id, k.weapon).deaths += 1;
  }

  const out = new Map<number, WeaponKillStat[]>();
  for (const [playerId, buckets] of byPlayer) {
    out.set(playerId, [...buckets.values()].sort((a, b) => b.kills - a.kills));
  }
  return out;
}

/** One player's slice of `groupWeaponKillStatsByPlayer()` — `[]` for a player with no kills/deaths
 *  in scope, matching the grouped map's own "simply absent" convention for that case. */
export function aggregateWeaponKillStats(kills: MatchKillRow[], playerId: number): WeaponKillStat[] {
  return groupWeaponKillStatsByPlayer(kills).get(playerId) ?? [];
}

/** The weapon a player has the most kills with, or `null` when they have none in scope. */
export function favoriteWeapon(stats: WeaponKillStat[]): WeaponKillStat | null {
  return stats.reduce<WeaponKillStat | null>((best, s) => (!best || s.kills > best.kills ? s : best), null);
}

/** Every distinct weapon (grouped via `weaponGroupKey()`, so knife/bayonet skins collapse to one
 *  `knife` entry — #474) with at least one credited kill (excludes self-kills/teamkills) across
 *  `kills`, sorted by total kill count descending — the option list for a "pick a specific weapon"
 *  filter (e.g. the Weapons sub-tab's weapon selector). */
export function allWeaponsWithKills(kills: MatchKillRow[]): string[] {
  const counts = new Map<string, number>();
  for (const k of kills) {
    if (k.attacker_player_id == null || k.attacker_player_id === k.victim_player_id || k.is_teamkill) continue;
    const key = weaponGroupKey(k.weapon);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
}

export interface HeadshotTeamkillCounts {
  headshot_kills: number;
  teamkills: number;
}

/** The subset of a kill row the `derive*()` functions in this file need (not every field is read by
 *  every function) — narrower than `MatchKillRow` so a pre-persistence caller (the demo-upload
 *  preview, working from `DemoMatchKill[]` before any `match_id` exists) can use it too, not just
 *  already-joined `match_kills` reads. */
export interface KillCreditFlags {
  match_id: number;
  round_number: number;
  tick: number;
  attacker_player_id: number | null;
  victim_player_id: number;
  assister_player_id: number | null;
  headshot: boolean;
  is_teamkill: boolean;
}

/** Groups kills by `` `${match_id}:${round_number}` `` — the round-grouping pass every per-round
 *  `derive*()` function (`deriveOpeningDuelCounts()`, `deriveTwoKRoundCounts()`,
 *  `deriveClutchCounts()`) needs before it can reason about "this round's kills" as a unit. */
function groupKillsByRound(kills: KillCreditFlags[]): Map<string, KillCreditFlags[]> {
  const byRound = new Map<string, KillCreditFlags[]>();
  for (const k of kills) {
    const key = `${k.match_id}:${k.round_number}`;
    const group = byRound.get(key);
    if (group) group.push(k);
    else byRound.set(key, [k]);
  }
  return byRound;
}

/**
 * Per (match, attacker) headshot-kill and teamkill counts, derived from `match_kills` — the
 * query-time replacement for the `headshot_kills`/`teamkills` columns `player_match_sabremetrics`
 * used to store directly (both were exact duplicates of data `match_kills` already carries).
 * Self-kills credit neither. A teamkill never also counts toward `headshot_kills` even when it
 * landed on the head, matching every other "credited kill" rule in this file
 * (`aggregateWeaponKillStats()`, `allWeaponsWithKills()`) and the CS2 engine's own `m_iKills`/
 * `m_iHeadShotKills` action-tracking stats those columns were originally sourced from, which don't
 * count teamkills either. Keyed by `` `${match_id}:${attacker_player_id}` `` so one map covers a
 * multi-match caller (`getAllSabremetrics()`) as well as a single-match one.
 */
export function deriveHeadshotAndTeamkillCounts(kills: KillCreditFlags[]): Map<string, HeadshotTeamkillCounts> {
  const out = new Map<string, HeadshotTeamkillCounts>();
  for (const k of kills) {
    if (k.attacker_player_id == null || k.attacker_player_id === k.victim_player_id) continue;
    const key = `${k.match_id}:${k.attacker_player_id}`;
    let c = out.get(key);
    if (!c) {
      c = { headshot_kills: 0, teamkills: 0 };
      out.set(key, c);
    }
    if (k.is_teamkill) c.teamkills += 1;
    else if (k.headshot) c.headshot_kills += 1;
  }
  return out;
}

/** A player's side (CT/T) for one round, from their fixed match `faction` and that round's
 *  `shirts_side` — an alias for `resolveSide()` (`parsers/roundSides.ts`), the one place this rule
 *  is defined (also used by `sideForFaction()` there and `tallyPlayerRoundsBySide()` in
 *  `mapSideStats.ts`), kept under this name since every caller in this file already uses it. */
export const resolvePlayerSide = resolveSide;

export interface SideSplitCounts {
  kills_ct: number;
  kills_t: number;
  deaths_ct: number;
  deaths_t: number;
  assists_ct: number;
  assists_t: number;
  headshot_kills_ct: number;
  headshot_kills_t: number;
}

/**
 * Per (match, player) kills/deaths/assists/headshot-kills split by the side they were on that
 * round — the query-time replacement for the same-named columns `player_match_sabremetrics` used
 * to store directly (all were exact duplicates of `match_kills` combined with side data, unlike
 * `headshot_kills`/`opening_kills`/`two_k_rounds`, which needed no side/faction lookup at all).
 * `roundSides` (`getRoundSides()`, `queries/rounds.ts`) and `playerFactions` are both keyed the same
 * way their source tables are: `` `${match_id}:${round_number}` `` and `` `${match_id}:${player_id}` ``
 * respectively. A round or player missing from either map (never resolved a side/faction) is
 * skipped rather than guessed at.
 *
 * Deaths always credit the victim's side, matching CS2's own unconditional `m_iDeaths` — a
 * self-kill or teamkill still ends the victim's round. Kills and headshot-kills use the same
 * "credited kill" exclusion as `deriveHeadshotAndTeamkillCounts()` (no self-kill, no teamkill).
 * Assists are credited whenever `match_kills.assister_player_match_stats_id` is set, with no
 * further exclusion — the parser (`collectMatchKills()`, `parsers/weaponStats.ts`) already only
 * ever records a real assister there, matching how CS2 itself never awards a friendly-fire assist.
 */
export function deriveSideSplitCounts(
  kills: KillCreditFlags[],
  roundSides: Map<string, RoundSideInfo>,
  playerFactions: Map<string, Faction>,
): Map<string, SideSplitCounts> {
  const out = new Map<string, SideSplitCounts>();
  const bump = (matchId: number, playerId: number, field: keyof SideSplitCounts): void => {
    bumpCounter(out, `${matchId}:${playerId}`, ZERO_SIDE_SPLIT, field);
  };
  const sideOf = (matchId: number, playerId: number, shirtsSide: 'CT' | 'T'): 'CT' | 'T' | undefined => {
    const faction = playerFactions.get(`${matchId}:${playerId}`);
    return faction == null ? undefined : resolvePlayerSide(shirtsSide, faction);
  };

  for (const k of kills) {
    const roundInfo = roundSides.get(`${k.match_id}:${k.round_number}`);
    if (roundInfo == null) continue;
    const shirtsSide = roundInfo.shirtsSide;

    const victimSide = sideOf(k.match_id, k.victim_player_id, shirtsSide);
    if (victimSide != null) bump(k.match_id, k.victim_player_id, victimSide === 'CT' ? 'deaths_ct' : 'deaths_t');

    if (k.attacker_player_id != null && k.attacker_player_id !== k.victim_player_id && !k.is_teamkill) {
      const attackerSide = sideOf(k.match_id, k.attacker_player_id, shirtsSide);
      if (attackerSide != null) {
        bump(k.match_id, k.attacker_player_id, attackerSide === 'CT' ? 'kills_ct' : 'kills_t');
        if (k.headshot) {
          bump(k.match_id, k.attacker_player_id, attackerSide === 'CT' ? 'headshot_kills_ct' : 'headshot_kills_t');
        }
      }
    }

    if (k.assister_player_id != null) {
      const assisterSide = sideOf(k.match_id, k.assister_player_id, shirtsSide);
      if (assisterSide != null) bump(k.match_id, k.assister_player_id, assisterSide === 'CT' ? 'assists_ct' : 'assists_t');
    }
  }
  return out;
}

export interface ClutchCounts {
  clutch_1v1_attempts: number;
  clutch_1v1_wins: number;
  clutch_1v2_attempts: number;
  clutch_1v2_wins: number;
  clutch_2v1_attempts: number;
  clutch_2v1_wins: number;
}

type ClutchCategory = '1v1' | '1v2';

function bumpClutch(
  out: Map<string, ClutchCounts>,
  matchId: number,
  playerId: number,
  attemptsKey: keyof ClutchCounts,
  winsKey: keyof ClutchCounts,
  won: boolean,
): void {
  const key = `${matchId}:${playerId}`;
  bumpCounter(out, key, ZERO_CLUTCH, attemptsKey);
  if (won) bumpCounter(out, key, ZERO_CLUTCH, winsKey);
}

/**
 * Per (match, player) clutch attempt/win counts — the query-time replacement for
 * `clutch_1v1`/`1v2`/`2v1_attempts`/`wins` on `player_match_sabremetrics`: for each round, replay
 * its kills in tick order against both sides' starting alive sets (every roster player, resolved to
 * CT/T via `resolvePlayerSide()`), crediting whoever's side drops to 1 facing
 * 1-2 enemies (1v1/1v2), and crediting a 2-alive side facing exactly 1 enemy a shared 2v1 advantage
 * (the choke-score numerator). A player who reaches a 1v2 and later narrows to a 1v1 (their
 * remaining teammate's death cut the enemy count further) gets credited both — the original 1v2
 * attempt/win stands, and a separate 1v1 attempt/win is added for the narrower phase.
 *
 * `roundSides`/`playerFactions` are the same maps `deriveSideSplitCounts()` takes. `rosterByMatch`
 * (every roster `player_id` per `match_id`, from `player_match_stats`) is the one extra input this
 * needs beyond a kill's own participants — clutch state depends on the *whole* alive roster each
 * round, not just who's involved in a given kill.
 *
 * A round absent from `kills` (nobody died) is skipped entirely rather than replayed with zero
 * deaths — equivalent, since a round where every roster player survives never moves either side's
 * alive count off its starting value, so it can never trigger a clutch/2v1 credit either way.
 */
export function deriveClutchCounts(
  kills: KillCreditFlags[],
  roundSides: Map<string, RoundSideInfo>,
  playerFactions: Map<string, Faction>,
  rosterByMatch: Map<number, number[]>,
): Map<string, ClutchCounts> {
  const out = new Map<string, ClutchCounts>();
  const byRound = groupKillsByRound(kills);

  for (const roundKills of byRound.values()) {
    const matchId = roundKills[0].match_id;
    const roundNumber = roundKills[0].round_number;
    const roundInfo = roundSides.get(`${matchId}:${roundNumber}`);
    if (roundInfo == null) continue;
    const roster = rosterByMatch.get(matchId);
    if (roster == null) continue;

    const ctAlive = new Set<number>();
    const tAlive = new Set<number>();
    for (const playerId of roster) {
      const faction = playerFactions.get(`${matchId}:${playerId}`);
      if (faction == null) continue;
      const side = resolvePlayerSide(roundInfo.shirtsSide, faction);
      (side === 'CT' ? ctAlive : tAlive).add(playerId);
    }

    const deaths = [...roundKills].sort((a, b) => a.tick - b.tick);
    const clutchState = new Map<'CT' | 'T', { playerId: number; category: ClutchCategory }>();
    const advantageRecorded = new Set<'CT' | 'T'>();

    for (const death of deaths) {
      const victim = death.victim_player_id;
      ctAlive.delete(victim);
      tAlive.delete(victim);

      for (const side of ['CT', 'T'] as const) {
        const myAlive = side === 'CT' ? ctAlive : tAlive;
        const enemyAlive = side === 'CT' ? tAlive : ctAlive;
        if (enemyAlive.size === 0) continue;

        const won = roundInfo.winnerSide === side;

        if (myAlive.size === 1) {
          const clutcher = [...myAlive][0];
          const enemyCount = enemyAlive.size;
          const existing = clutchState.get(side);

          if (existing?.playerId === clutcher) {
            if (existing.category === '1v2' && enemyCount === 1) {
              bumpClutch(out, matchId, clutcher, 'clutch_1v1_attempts', 'clutch_1v1_wins', won);
            }
            continue;
          }

          if (enemyCount > 2) continue;

          const category: ClutchCategory = enemyCount === 1 ? '1v1' : '1v2';
          clutchState.set(side, { playerId: clutcher, category });
          if (category === '1v1') {
            bumpClutch(out, matchId, clutcher, 'clutch_1v1_attempts', 'clutch_1v1_wins', won);
          } else {
            bumpClutch(out, matchId, clutcher, 'clutch_1v2_attempts', 'clutch_1v2_wins', won);
          }
        } else if (myAlive.size === 2 && enemyAlive.size === 1) {
          if (advantageRecorded.has(side)) continue;
          advantageRecorded.add(side);

          for (const teammate of myAlive) {
            bumpClutch(out, matchId, teammate, 'clutch_2v1_attempts', 'clutch_2v1_wins', won);
          }
        }
      }
    }
  }

  return out;
}

export interface NinjaCandidateRound {
  match_id: number;
  round_number: number;
  winner_side: 'CT' | 'T';
  win_reason: RoundCondition | null;
}

export interface NinjaVictim {
  match_id: number;
  round_number: number;
  victim_player_id: number;
}

/**
 * Every `` `${match_id}:${round_number}` `` where the round was won by a defuse while at least one
 * T-side player was still alive — a "ninja" defuse, the bomb defused without ever being contested.
 * Only rounds with `win_reason === 'defuse'` and `winner_side === 'CT'` are candidates; every other
 * round is skipped without being counted either way. A round whose match has no resolvable T-side
 * roster (missing `player_match_stats` faction data) is never flagged, the same "don't guess"
 * exclusion `aggregateWinConditions()` (`mapSideStats.ts`) already applies to a null `win_reason`.
 *
 * `roundSides`/`playerFactions`/`rosterByMatch` are the same three inputs `deriveClutchCounts()`
 * takes — this needs the same "which side was this roster player on this round" resolution, just
 * evaluated once at round end instead of kill-by-kill.
 */
export function deriveNinjaDefuseRounds(
  rounds: NinjaCandidateRound[],
  victims: NinjaVictim[],
  roundSides: Map<string, RoundSideInfo>,
  playerFactions: Map<string, Faction>,
  rosterByMatch: Map<number, number[]>,
): Set<string> {
  const victimsByRound = new Map<string, number[]>();
  for (const v of victims) {
    const key = `${v.match_id}:${v.round_number}`;
    const list = victimsByRound.get(key);
    if (list) list.push(v.victim_player_id);
    else victimsByRound.set(key, [v.victim_player_id]);
  }

  const out = new Set<string>();
  for (const r of rounds) {
    if (r.win_reason !== 'defuse' || r.winner_side !== 'CT') continue;
    const key = `${r.match_id}:${r.round_number}`;
    const roundInfo = roundSides.get(key);
    if (roundInfo == null) continue;
    const roster = rosterByMatch.get(r.match_id);
    if (roster == null) continue;

    const sideOf = (playerId: number): 'CT' | 'T' | undefined => {
      const faction = playerFactions.get(`${r.match_id}:${playerId}`);
      return faction == null ? undefined : resolveSide(roundInfo.shirtsSide, faction);
    };

    const tRosterSize = roster.filter((playerId) => sideOf(playerId) === 'T').length;
    if (tRosterSize === 0) continue;
    const tDead = new Set((victimsByRound.get(key) ?? []).filter((playerId) => sideOf(playerId) === 'T'));
    if (tDead.size < tRosterSize) out.add(key);
  }
  return out;
}

export interface OpeningDuelCounts {
  opening_kills: number;
  opening_deaths: number;
}

/**
 * Per (match, player) opening-kill/opening-death counts, derived from `match_kills` — the
 * query-time replacement for the `opening_kills`/`opening_deaths` columns
 * `player_match_sabremetrics` used to store directly (both were computable from `match_kills` alone,
 * needing no side/faction data at all). The earliest death by tick in each round always credits its
 * victim an opening death; the attacker credits an opening kill unless there wasn't one (a
 * world/environment death) or it was a teamkill. Keyed by `` `${match_id}:${player_id}` ``.
 */
export function deriveOpeningDuelCounts(kills: KillCreditFlags[]): Map<string, OpeningDuelCounts> {
  const byRound = groupKillsByRound(kills);

  const out = new Map<string, OpeningDuelCounts>();
  const bump = (matchId: number, playerId: number, field: keyof OpeningDuelCounts): void => {
    const key = `${matchId}:${playerId}`;
    let c = out.get(key);
    if (!c) {
      c = { opening_kills: 0, opening_deaths: 0 };
      out.set(key, c);
    }
    c[field] += 1;
  };

  for (const roundKills of byRound.values()) {
    const first = roundKills.reduce((a, b) => (a.tick <= b.tick ? a : b));
    bump(first.match_id, first.victim_player_id, 'opening_deaths');
    if (
      first.attacker_player_id != null
      && first.attacker_player_id !== first.victim_player_id
      && !first.is_teamkill
    ) {
      bump(first.match_id, first.attacker_player_id, 'opening_kills');
    }
  }
  return out;
}

/**
 * Per (match, attacker) count of rounds where they killed both opponents — the query-time
 * replacement for `player_match_sabremetrics.two_k_rounds`. Derived from `match_kills` alone, no
 * roster/faction data needed: in 2v2 Wingman a player has exactly one teammate and two opponents,
 * `match_kills` enforces at most one kill per (round, victim), and a teamkill is already flagged —
 * so two non-teamkill kills by the same attacker in the same round can only be both opponents,
 * without needing to resolve who those enemies are from roster/faction data.
 */
export function deriveTwoKRoundCounts(kills: KillCreditFlags[]): Map<string, number> {
  const byRound = groupKillsByRound(kills);

  const out = new Map<string, number>();
  for (const roundKills of byRound.values()) {
    const perAttacker = new Map<number, number>();
    for (const k of roundKills) {
      if (k.attacker_player_id == null || k.is_teamkill || k.attacker_player_id === k.victim_player_id) continue;
      const attackerId = k.attacker_player_id;
      perAttacker.set(attackerId, (perAttacker.get(attackerId) ?? 0) + 1);
    }
    for (const [attackerId, count] of perAttacker) {
      if (count !== 2) continue;
      const key = `${roundKills[0].match_id}:${attackerId}`;
      out.set(key, (out.get(key) ?? 0) + 1);
    }
  }
  return out;
}

export interface KillCreditCounts {
  hsTk: Map<string, HeadshotTeamkillCounts>;
  openingDuels: Map<string, OpeningDuelCounts>;
  twoKRounds: Map<string, number>;
}

/** Runs all three `match_kills`-derived counters over one shared `kills` array — every caller that
 *  needs `headshot_kills`/`teamkills`/`opening_kills`/`opening_deaths`/`two_k_rounds` (the match/
 *  season/career sabremetric queries, plus the demo-upload preview and `inspect-demo.ts`, which
 *  derive from their own pre-persistence `matchKills`) needs the same three maps together. */
export function deriveKillCreditCounts(kills: KillCreditFlags[]): KillCreditCounts {
  return {
    hsTk: deriveHeadshotAndTeamkillCounts(kills),
    openingDuels: deriveOpeningDuelCounts(kills),
    twoKRounds: deriveTwoKRoundCounts(kills),
  };
}

export interface DerivedSabFields {
  headshot_kills: number;
  teamkills: number;
  opening_kills: number;
  opening_deaths: number;
  two_k_rounds: number;
  shots_fired: number;
  shots_hit: number;
  headshot_hits: number;
  kills_ct: number;
  kills_t: number;
  deaths_ct: number;
  deaths_t: number;
  assists_ct: number;
  assists_t: number;
  headshot_kills_ct: number;
  headshot_kills_t: number;
  clutch_1v1_attempts: number;
  clutch_1v1_wins: number;
  clutch_1v2_attempts: number;
  clutch_1v2_wins: number;
  clutch_2v1_attempts: number;
  clutch_2v1_wins: number;
  flash_assists: number;
  teamflash_duration: number;
  enemies_flashed: number;
  flashes_leading_to_kill: number;
  effective_flashes: number;
  blind_duration_dealt: number;
  blind_duration_max_sum: number;
}

const ZERO_SIDE_SPLIT: SideSplitCounts = {
  kills_ct: 0, kills_t: 0, deaths_ct: 0, deaths_t: 0,
  assists_ct: 0, assists_t: 0, headshot_kills_ct: 0, headshot_kills_t: 0,
};

const ZERO_CLUTCH: ClutchCounts = {
  clutch_1v1_attempts: 0, clutch_1v1_wins: 0,
  clutch_1v2_attempts: 0, clutch_1v2_wins: 0,
  clutch_2v1_attempts: 0, clutch_2v1_wins: 0,
};

/** Looks up one `` `${match_id}:${player_id}` `` key across `deriveKillCreditCounts()`'s three maps,
 *  a `deriveAccuracyTotals()`-shaped accuracy map, a `deriveSideSplitCounts()`-shaped side-split map,
 *  a `deriveClutchCounts()`-shaped clutch map, and a `deriveUtilityCounts()`-shaped utility map,
 *  defaulting every field to 0 when a player has no credited rows in a given map (never played a
 *  round, never fired a gun, side unresolved, never threw a flash, etc.) — the shared merge every
 *  `SabFieldsWithDerived` builder (`getAllSabremetrics()`, `getMatchSabremetrics()`, the demo-upload
 *  preview) applies identically over the stored `player_match_sabremetrics` row. */
export function lookupDerivedSabFields(
  key: string,
  counts: KillCreditCounts,
  accuracy: Map<string, AccuracyTotals>,
  sideSplit: Map<string, SideSplitCounts>,
  clutch: Map<string, ClutchCounts>,
  utility: Map<string, UtilityCounts>,
): DerivedSabFields {
  const hsTkCounts = counts.hsTk.get(key);
  const opening = counts.openingDuels.get(key);
  const acc = accuracy.get(key);
  const split = sideSplit.get(key) ?? ZERO_SIDE_SPLIT;
  const clutchCounts = clutch.get(key) ?? ZERO_CLUTCH;
  const utilityCounts = utility.get(key) ?? ZERO_UTILITY;
  return {
    headshot_kills: hsTkCounts?.headshot_kills ?? 0,
    teamkills: hsTkCounts?.teamkills ?? 0,
    opening_kills: opening?.opening_kills ?? 0,
    opening_deaths: opening?.opening_deaths ?? 0,
    two_k_rounds: counts.twoKRounds.get(key) ?? 0,
    shots_fired: acc?.shots_fired ?? 0,
    shots_hit: acc?.shots_hit ?? 0,
    headshot_hits: acc?.headshot_hits ?? 0,
    ...split,
    ...clutchCounts,
    ...utilityCounts,
  };
}

/** Resolves which of a player's `WeaponKillStat[]` a "favorite vs specific weapon" filter should
 *  show: `weapon === null` picks their favorite (`favoriteWeapon()`); a specific weapon name looks
 *  it up (grouped via `weaponGroupKey()`, so a raw skin name still finds its `knife` bucket),
 *  falling back to a zeroed stat (rather than `null`) when the player has no kills/deaths with it —
 *  so a specific-weapon selection always renders a row for every player, per the Weapons sub-tab's
 *  filter contract. Not exported — every caller (`resolveWeaponFilterStat()`'s `favorite`/`weapon`
 *  branches, `aggregateFlairKillStats()`'s uncredited-death lookups) lives in this same file. */
function resolveWeaponStat(stats: WeaponKillStat[], weapon: string | null): WeaponKillStat | null {
  if (weapon == null) return favoriteWeapon(stats);
  const key = weaponGroupKey(weapon);
  return stats.find((s) => s.weapon === key) ?? zeroWeaponStat(key);
}

/** The Weapons sub-tab's filter selection, as a real discriminated union rather than an encoded
 *  string (#474) — `favorite` picks each player's own favorite weapon; `weapon` scopes to one
 *  specific weapon (grouped via `weaponGroupKey()`); `category` scopes to every weapon in a whole
 *  `KillWeaponCategory`, rolled up via `aggregateKillCategoryStats()`. `WeaponFilterSelect`
 *  (`SabremetricsLeaderboardView.tsx`) is the only place that needs a string form of this, to
 *  satisfy the HTML `<select>` API — it encodes/decodes locally rather than a string encoding
 *  leaking out to every other consumer of the selection. */
export type WeaponFilter =
  | { kind: 'favorite' }
  | { kind: 'weapon'; weapon: string }
  | { kind: 'category'; category: KillWeaponCategory };

export const FAVORITE_WEAPON_FILTER: WeaponFilter = { kind: 'favorite' };

/** One filter-resolved row's worth of kill stats plus the display label to show for it — the
 *  common shape `resolveWeaponFilterStat()` returns whether the Weapons sub-tab filter picked a
 *  favorite, one weapon, or a whole category (#474), so the table/tile renderers need only one
 *  resolve call and one set of fields regardless of which mode is active. */
export interface WeaponFilterStat {
  label: string;
  /** The specific weapon these stats are for, or `null` when scoped to a whole category (or there's
   *  no favorite to show) — lets the UI render a weapon icon only when there's one specific weapon
   *  to show it for. */
  weapon: string | null;
  kills: number;
  headshotKills: number;
  noscopeKills: number;
  wallbangKills: number;
  blindKills: number;
  midairKills: number;
  deaths: number;
  /** Shot/accuracy/damage/rounds breakdown for this selection (#474) — `null` when the selection
   *  has no such concept at all (a melee/utility/other weapon or category; CS2 tracks no
   *  shots-fired for a knife swing or grenade throw), which is a different thing from a real *zero*
   *  (a gun the player simply didn't fire in scope, which resolves to a zeroed `WeaponClassAggregateStat`
   *  instead of `null`). */
  accuracy: WeaponClassAggregateStat | null;
}

/** Builds a `WeaponFilterStat` from a resolved count source (a `WeaponKillStat` or
 *  `WeaponCategoryKillStat`, both share the same six count fields) — the one place
 *  `resolveWeaponFilterStat()`'s weapon and category branches both build their result, instead of
 *  each restating the same six `?? 0` defaults. */
function toFilterStat(
  label: string,
  weapon: string | null,
  stat: { kills: number; headshotKills: number; noscopeKills: number; wallbangKills: number; blindKills: number; midairKills: number; deaths: number } | undefined,
  accuracy: WeaponClassAggregateStat | null,
): WeaponFilterStat {
  return {
    label,
    weapon,
    kills: stat?.kills ?? 0,
    headshotKills: stat?.headshotKills ?? 0,
    noscopeKills: stat?.noscopeKills ?? 0,
    wallbangKills: stat?.wallbangKills ?? 0,
    blindKills: stat?.blindKills ?? 0,
    midairKills: stat?.midairKills ?? 0,
    deaths: stat?.deaths ?? 0,
    accuracy,
  };
}

/** Resolves a player's `WeaponKillStat[]` against the Weapons sub-tab's three-mode `WeaponFilter`
 *  (#474), also resolving that same selection's accuracy from `accuracy` (this player's
 *  `PlayerWeaponAccuracy`, from `groupWeaponAccuracyByPlayer()` — `queries/weaponStats.ts`) when
 *  omitted, every gun weapon/category still resolves a real zeroed accuracy stat rather than `null`
 *  (an absent `accuracy` map just means "no rows fetched yet", not "no such stat exists"). A
 *  category or weapon with no kills/deaths in scope still resolves a zeroed kill row (matching
 *  `resolveWeaponStat()`'s own no-kills fallback) rather than `null`, so a selection always renders
 *  a row for every player. */
export function resolveWeaponFilterStat(
  stats: WeaponKillStat[],
  filter: WeaponFilter,
  accuracy?: PlayerWeaponAccuracy,
): WeaponFilterStat {
  if (filter.kind === 'category') {
    const catStat = aggregateKillCategoryStats(stats).find((c) => c.category === filter.category);
    const isGunCategory = (WEAPON_CATEGORIES as string[]).includes(filter.category);
    const acc = isGunCategory
      ? (accuracy?.byCategory.get(filter.category as WeaponCategory) ?? ZERO_WEAPON_CLASS_STAT)
      : null;
    return toFilterStat(KILL_WEAPON_CATEGORY_LABEL[filter.category], null, catStat, acc);
  }
  const resolved = resolveWeaponStat(stats, filter.kind === 'weapon' ? filter.weapon : null);
  const weapon = resolved?.weapon ?? null;
  const acc = weapon != null && isGunWeapon(weapon)
    ? (accuracy?.byWeapon.get(weapon) ?? ZERO_WEAPON_CLASS_STAT)
    : null;
  return toFilterStat(resolved ? weaponDisplayName(resolved.weapon) : '—', weapon, resolved ?? undefined, acc);
}

export interface WeaponCategoryKillStat {
  category: KillWeaponCategory;
  kills: number;
  headshotKills: number;
  noscopeKills: number;
  wallbangKills: number;
  blindKills: number;
  midairKills: number;
  deaths: number;
}

/** Rolls `WeaponKillStat[]` up into category totals, reusing each weapon's already-resolved
 *  `killWeaponCategory()` bucket rather than reclassifying. */
export function aggregateKillCategoryStats(stats: WeaponKillStat[]): WeaponCategoryKillStat[] {
  const buckets = new Map<KillWeaponCategory, WeaponCategoryKillStat>();
  for (const s of stats) {
    let b = buckets.get(s.category);
    if (!b) {
      b = {
        category: s.category,
        kills: 0,
        headshotKills: 0,
        noscopeKills: 0,
        wallbangKills: 0,
        blindKills: 0,
        midairKills: 0,
        deaths: 0,
      };
      buckets.set(s.category, b);
    }
    b.kills += s.kills;
    b.headshotKills += s.headshotKills;
    b.noscopeKills += s.noscopeKills;
    b.wallbangKills += s.wallbangKills;
    b.blindKills += s.blindKills;
    b.midairKills += s.midairKills;
    b.deaths += s.deaths;
  }
  return [...buckets.values()].sort((a, b) => b.kills - a.kills);
}

export interface FlairKillStat {
  noscopeKills: number;
  wallbangKills: number;
  blindKills: number;
  midairKills: number;
  knifeKills: number;
  /** Deaths to fall damage / other environmental causes (`match_kills.weapon === 'world'`) — never
   *  has a real attacker (`killWeaponCategory()`), so it's an uncredited-death count, not a kill
   *  count like every other field here (#498). */
  fallDamageDeaths: number;
  /** Deaths to bomb detonation (`match_kills.weapon === 'planted_c4'`) — same uncredited-death
   *  shape as `fallDamageDeaths` (#498). */
  c4Deaths: number;
}

/** "Flair" kills — the off-meta kill counts worth showing off on their own, summed across every
 *  weapon rather than broken out per-weapon like `aggregateWeaponKillStats()`. `noscopeKills`/
 *  `wallbangKills`/`blindKills`/`midairKills` total the same-named `WeaponKillStat` counters
 *  across every weapon a player has kills with; `knifeKills` reuses `aggregateKillCategoryStats()`'s
 *  `melee` category total (knives/bayonets) rather than reclassifying weapons itself.
 *  `fallDamageDeaths`/`c4Deaths` read the `WORLD_DEATH_WEAPON`/`PLANTED_C4_DEATH_WEAPON` buckets'
 *  `deaths` directly (via the same `resolveWeaponStat()` lookup `resolveWeaponFilterStat()` uses)
 *  rather than through `aggregateKillCategoryStats()`'s `other` rollup, which would merge the two
 *  causes together — the Weapons sub-tab's dedicated uncredited-death display needs them told apart
 *  (#498). */
export function aggregateFlairKillStats(kills: MatchKillRow[], playerId: number): FlairKillStat {
  const stats = aggregateWeaponKillStats(kills, playerId);
  const knifeKills = aggregateKillCategoryStats(stats).find((c) => c.category === 'melee')?.kills ?? 0;
  return {
    noscopeKills: stats.reduce((n, s) => n + s.noscopeKills, 0),
    wallbangKills: stats.reduce((n, s) => n + s.wallbangKills, 0),
    blindKills: stats.reduce((n, s) => n + s.blindKills, 0),
    midairKills: stats.reduce((n, s) => n + s.midairKills, 0),
    knifeKills,
    fallDamageDeaths: resolveWeaponStat(stats, WORLD_DEATH_WEAPON)?.deaths ?? 0,
    c4Deaths: resolveWeaponStat(stats, PLANTED_C4_DEATH_WEAPON)?.deaths ?? 0,
  };
}
