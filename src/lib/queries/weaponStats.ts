import { supabase } from '../supabase';
import type { PlayerMatchWeaponStat, PlayerMatchEconomyStat, WeaponStatFields, Player } from '../types';
import { getPlayersById } from './player';
import { resolveMatchSeasons, fetchAllPages, fetchPmsLookup, asPage } from './_shared';
import type { WeaponCategory } from '../parsers/weaponClasses';

export interface WeaponClassMatchRow extends WeaponStatFields {
  player_id: number;
  player_name: string;
  match_id: number;
  season_id: number;
  weapon_category: string;
}

export interface EconomyMatchRow extends WeaponStatFields {
  player_id: number;
  player_name: string;
  match_id: number;
  season_id: number;
  economy_type: string;
}

interface BreakdownRow extends WeaponStatFields {
  player_id: number;
  player_name: string;
  match_id: number;
  season_id: number;
  bucket: string;
}

/** Shared by `getAllWeaponClassStats()`/`getAllEconomyStats()` — same join and season-scoping,
 *  differing only in which table/bucket column is read. `seasonId` filters to a single season the
 *  same way `getAllSabremetrics()` does. Pass `playersById` when the caller already fetched it
 *  (e.g. alongside `getAllMatchKills()`) to skip a redundant full `players` table read. */
async function getAllBreakdownStats(
  table: 'player_match_weapon_stats' | 'player_match_economy_stats',
  bucketColumn: 'weapon_category' | 'economy_type',
  seasonId?: number,
  playersById?: Map<number, Player> | Promise<Map<number, Player>>,
): Promise<BreakdownRow[]> {
  const [rows, pmsRows, matchSeason, resolvedPlayersById] = await Promise.all([
    fetchAllPages<PlayerMatchWeaponStat | PlayerMatchEconomyStat>((from, to) =>
      supabase.from(table).select('*').range(from, to),
    ),
    fetchAllPages<{ id: number; player_id: number; match_id: number }>((from, to) =>
      asPage(supabase.from('player_match_stats').select('id, player_id, match_id').range(from, to)),
    ),
    resolveMatchSeasons(),
    playersById ? Promise.resolve(playersById) : getPlayersById(),
  ]);

  const pmsLookup = new Map<number, { player_id: number; match_id: number }>();
  for (const r of pmsRows) pmsLookup.set(r.id, r);

  const result: BreakdownRow[] = [];
  for (const raw of rows) {
    const pms = pmsLookup.get(raw.player_match_stats_id);
    if (!pms) continue;
    const sid = matchSeason.get(pms.match_id);
    if (sid == null) continue;
    if (seasonId != null && sid !== seasonId) continue;
    const player = resolvedPlayersById.get(pms.player_id);
    result.push({
      player_id: pms.player_id,
      player_name: player?.name ?? `#${pms.player_id}`,
      match_id: pms.match_id,
      season_id: sid,
      bucket: (raw as unknown as Record<string, string>)[bucketColumn],
      shots_fired: raw.shots_fired,
      shots_hit: raw.shots_hit,
      headshot_hits: raw.headshot_hits,
      damage_dealt: raw.damage_dealt,
      rounds_played: raw.rounds_played,
    });
  }
  return result;
}

/** Per-weapon-category shot/accuracy/damage/rounds breakdown (#279), one row per (player, match,
 *  weapon_category). Pass `playersById` when the caller already fetched it (e.g. shared with an
 *  adjacent `getAllMatchKills()` call) to skip a redundant full `players` table read. */
export async function getAllWeaponClassStats(
  seasonId?: number,
  playersById?: Map<number, Player> | Promise<Map<number, Player>>,
): Promise<WeaponClassMatchRow[]> {
  const rows = await getAllBreakdownStats('player_match_weapon_stats', 'weapon_category', seasonId, playersById);
  return rows.map(({ bucket, ...r }) => ({ ...r, weapon_category: bucket }));
}

/** Per-round-economy shot/accuracy/damage/rounds breakdown (#279), one row per (player, match,
 *  economy_type). */
export async function getAllEconomyStats(seasonId?: number): Promise<EconomyMatchRow[]> {
  const rows = await getAllBreakdownStats('player_match_economy_stats', 'economy_type', seasonId);
  return rows.map(({ bucket, ...r }) => ({ ...r, economy_type: bucket }));
}

/** One match's `player_match_weapon_stats` rows, joined to player names — the match-page-scoped
 *  counterpart to `getAllWeaponClassStats()` (avoids a full-table fetch for one match's box score,
 *  same reasoning as `getMatchKills()` vs `getAllMatchKills()` — `kills.ts`). `season_id` is left
 *  unresolved (`-1`) since a match-page caller already knows its own season and doesn't need it,
 *  matching `getMatchKills()`'s own convention for the identical reason (#474). */
export async function getMatchWeaponClassStats(
  matchId: number,
  playersById?: Map<number, Player> | Promise<Map<number, Player>>,
): Promise<WeaponClassMatchRow[]> {
  const [rows, pmsLookup, resolvedPlayersById] = await Promise.all([
    fetchAllPages<PlayerMatchWeaponStat>((from, to) =>
      supabase.from('player_match_weapon_stats').select('*').eq('match_id', matchId).range(from, to),
    ),
    fetchPmsLookup(matchId),
    playersById ? Promise.resolve(playersById) : getPlayersById(),
  ]);

  const result: WeaponClassMatchRow[] = [];
  for (const raw of rows) {
    const pms = pmsLookup.get(raw.player_match_stats_id);
    if (!pms) continue;
    const player = resolvedPlayersById.get(pms.player_id);
    result.push({
      player_id: pms.player_id,
      player_name: player?.name ?? `#${pms.player_id}`,
      match_id: pms.match_id,
      season_id: -1,
      weapon_category: raw.weapon_category,
      shots_fired: raw.shots_fired,
      shots_hit: raw.shots_hit,
      headshot_hits: raw.headshot_hits,
      damage_dealt: raw.damage_dealt,
      rounds_played: raw.rounds_played,
    });
  }
  return result;
}

/** Same 5 fields as `WeaponStatFields` — aliased under its own name since this one is always a
 *  cross-match *sum* (`groupWeaponClassStatsByPlayer()`/`aggregateWeaponClassStat()`'s result),
 *  never a single stored row, but the shape is identical so there's no reason to redeclare it. */
export type WeaponClassAggregateStat = WeaponStatFields;

/** The zeroed shape a player with no rows for a category falls back to — exported so
 *  `WeaponClassBreakdownTable` (`SabremetricsLeaderboardView.tsx`) can default a
 *  `groupWeaponClassStatsByPlayer()` miss to the same shape `aggregateWeaponClassStat()` does. */
export const ZERO_WEAPON_CLASS_STAT: WeaponClassAggregateStat = {
  shots_fired: 0, shots_hit: 0, headshot_hits: 0, damage_dealt: 0, rounds_played: 0,
};

/** Sums every player's `WeaponClassMatchRow`s for one gun category across every match in whatever
 *  scope the caller already fetched `rows` for (a season, career) in a single pass — the group-then-
 *  sum counterpart of `aggregateWeaponKillStats()`'s per-weapon buckets, but grouped by player
 *  instead so a multi-player table (`WeaponClassBreakdownTable`) can look each row up in O(1)
 *  rather than rescanning all of `rows` once per player (#474). Players with no rows for `category`
 *  are simply absent from the map — callers fall back to a zeroed stat via `aggregateWeaponClassStat()`
 *  or their own default. */
export function groupWeaponClassStatsByPlayer(
  rows: WeaponClassMatchRow[],
  category: WeaponCategory,
): Map<number, WeaponClassAggregateStat> {
  const out = new Map<number, WeaponClassAggregateStat>();
  for (const r of rows) {
    if (r.weapon_category !== category) continue;
    let c = out.get(r.player_id);
    if (!c) {
      c = { ...ZERO_WEAPON_CLASS_STAT };
      out.set(r.player_id, c);
    }
    c.shots_fired += r.shots_fired;
    c.shots_hit += r.shots_hit;
    c.headshot_hits += r.headshot_hits;
    c.damage_dealt += r.damage_dealt;
    c.rounds_played += r.rounds_played;
  }
  return out;
}

/** One player's rollup from `groupWeaponClassStatsByPlayer()`, zeroed when they have no rows for
 *  `category` in scope — the single-player convenience wrapper (`buildWeaponClassTiles()`'s only
 *  caller); a multi-player table should call `groupWeaponClassStatsByPlayer()` once itself instead
 *  of calling this per player. */
export function aggregateWeaponClassStat(
  rows: WeaponClassMatchRow[],
  playerId: number,
  category: WeaponCategory,
): WeaponClassAggregateStat {
  return groupWeaponClassStatsByPlayer(rows, category).get(playerId) ?? { ...ZERO_WEAPON_CLASS_STAT };
}

export interface AccuracyTotals {
  shots_fired: number;
  shots_hit: number;
  headshot_hits: number;
}

/** Sums already-joined `(match_id, player_id)` accuracy rows into per-`` `${match_id}:${player_id}` ``
 *  totals — the pure accumulation step behind `deriveAccuracyTotals()`, factored out so a
 *  pre-persistence caller (the demo-upload preview, working from in-memory `DemoWeaponStat[]` before
 *  any `player_match_weapon_stats` row exists) can reuse the same summing rule instead of
 *  reimplementing it. */
export function sumAccuracyTotals(
  rows: { match_id: number; player_id: number; shots_fired: number; shots_hit: number; headshot_hits: number }[],
): Map<string, AccuracyTotals> {
  const out = new Map<string, AccuracyTotals>();
  for (const r of rows) {
    const key = `${r.match_id}:${r.player_id}`;
    let c = out.get(key);
    if (!c) {
      c = { shots_fired: 0, shots_hit: 0, headshot_hits: 0 };
      out.set(key, c);
    }
    c.shots_fired += r.shots_fired;
    c.shots_hit += r.shots_hit;
    c.headshot_hits += r.headshot_hits;
  }
  return out;
}

/**
 * Per (match, player) `shots_fired`/`shots_hit`/`headshot_hits` totals, summed from
 * `player_match_weapon_stats` — the query-time replacement for the same-named flat columns
 * `player_match_sabremetrics` used to store directly. Both are computed from the identical gated
 * event set: `collectAccuracy()` (`parsers/accuracy.ts`) and `collectWeaponClassStats()`
 * (`parsers/weaponStats.ts`) apply the same `WEAPON_CATEGORY` allowlist and self-kill/teamkill
 * exclusion — `collectAccuracy()`'s totals just don't bucket by category the way the weapon-class
 * breakdown does — so summing every `weapon_category` row for a player+match reproduces the flat
 * total exactly. (`player_match_economy_stats` does *not* match: its inclusion isn't gated by
 * `WEAPON_CATEGORY` at all, so it counts non-gun weapons `collectAccuracy()` excludes.) Keyed by
 * `` `${match_id}:${player_id}` ``. Pass `matchId` to scope both queries to one match — the
 * match-page caller (`getMatchSabremetrics()`) doesn't need a full-table fetch just to look up one
 * match's totals, the same way `getMatchKills(matchId)` scopes its own `match_kills` read. Pass
 * `pmsRows` when the caller already fetched `player_match_stats` (e.g. `getAllSabremetrics()`'s own
 * `id, player_id, match_id, rounds_played` read, structurally compatible) to skip a redundant
 * full-table fetch.
 */
export async function deriveAccuracyTotals(
  matchId?: number,
  pmsRows?: { id: number; player_id: number; match_id: number }[] | Promise<{ id: number; player_id: number; match_id: number }[]>,
): Promise<Map<string, AccuracyTotals>> {
  const [rows, resolvedPmsRows] = await Promise.all([
    fetchAllPages<{ player_match_stats_id: number; shots_fired: number; shots_hit: number; headshot_hits: number }>(
      (from, to) => {
        let q = supabase.from('player_match_weapon_stats')
          .select('player_match_stats_id, shots_fired, shots_hit, headshot_hits');
        if (matchId != null) q = q.eq('match_id', matchId);
        return asPage(q.range(from, to));
      },
    ),
    pmsRows ?? fetchAllPages<{ id: number; player_id: number; match_id: number }>((from, to) => {
      let q = supabase.from('player_match_stats').select('id, player_id, match_id');
      if (matchId != null) q = q.eq('match_id', matchId);
      return asPage(q.range(from, to));
    }),
  ]);

  const pmsLookup = new Map<number, { player_id: number; match_id: number }>();
  for (const r of resolvedPmsRows) pmsLookup.set(r.id, r);

  const joined: { match_id: number; player_id: number; shots_fired: number; shots_hit: number; headshot_hits: number }[] = [];
  for (const r of rows) {
    const pms = pmsLookup.get(r.player_match_stats_id);
    if (!pms) continue;
    joined.push({
      match_id: pms.match_id, player_id: pms.player_id,
      shots_fired: r.shots_fired, shots_hit: r.shots_hit, headshot_hits: r.headshot_hits,
    });
  }
  return sumAccuracyTotals(joined);
}
