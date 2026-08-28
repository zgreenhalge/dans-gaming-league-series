import { supabase } from '../supabase';
import type { PlayerMatchWeaponStat, PlayerMatchEconomyStat, WeaponStatFields, Player } from '../types';
import { getPlayersById } from './player';
import { resolveMatchSeasons, fetchAllPages, asPage } from './_shared';
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
 *  same way `getAllSabremetrics()` does. */
async function getAllBreakdownStats(
  table: 'player_match_weapon_stats' | 'player_match_economy_stats',
  bucketColumn: 'weapon_category' | 'economy_type',
  seasonId?: number,
): Promise<BreakdownRow[]> {
  const [rows, pmsRows, matchSeason, playersById] = await Promise.all([
    fetchAllPages<PlayerMatchWeaponStat | PlayerMatchEconomyStat>((from, to) =>
      supabase.from(table).select('*').range(from, to),
    ),
    fetchAllPages<{ id: number; player_id: number; match_id: number }>((from, to) =>
      asPage(supabase.from('player_match_stats').select('id, player_id, match_id').range(from, to)),
    ),
    resolveMatchSeasons(),
    getPlayersById(),
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
    const player = playersById.get(pms.player_id);
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
 *  weapon_category). */
export async function getAllWeaponClassStats(seasonId?: number): Promise<WeaponClassMatchRow[]> {
  const rows = await getAllBreakdownStats('player_match_weapon_stats', 'weapon_category', seasonId);
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
  const [rows, pmsRows, resolvedPlayersById] = await Promise.all([
    fetchAllPages<PlayerMatchWeaponStat>((from, to) =>
      supabase.from('player_match_weapon_stats').select('*').eq('match_id', matchId).range(from, to),
    ),
    fetchAllPages<{ id: number; player_id: number; match_id: number }>((from, to) =>
      asPage(supabase.from('player_match_stats').select('id, player_id, match_id').eq('match_id', matchId).range(from, to)),
    ),
    playersById ? Promise.resolve(playersById) : getPlayersById(),
  ]);

  const pmsLookup = new Map<number, { player_id: number; match_id: number }>();
  for (const r of pmsRows) pmsLookup.set(r.id, r);

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

export interface WeaponClassAggregateStat {
  shots_fired: number;
  shots_hit: number;
  headshot_hits: number;
  damage_dealt: number;
  rounds_played: number;
}

const ZERO_WEAPON_CLASS_STAT: WeaponClassAggregateStat = {
  shots_fired: 0, shots_hit: 0, headshot_hits: 0, damage_dealt: 0, rounds_played: 0,
};

/** Sums one player's `WeaponClassMatchRow`s for one gun category across every match in whatever
 *  scope the caller already fetched `rows` for (a season, career) — `getAllWeaponClassStats()`
 *  returns one row per (player, match, category), not pre-aggregated across matches, so the
 *  Weapons sub-tab's category breakdown (#474) needs this rollup the same way `aggregateWeaponKillStats()`
 *  rolls up per-match `match_kills` rows for the kills side of that same tab. */
export function aggregateWeaponClassStat(
  rows: WeaponClassMatchRow[],
  playerId: number,
  category: WeaponCategory,
): WeaponClassAggregateStat {
  const out = { ...ZERO_WEAPON_CLASS_STAT };
  for (const r of rows) {
    if (r.player_id !== playerId || r.weapon_category !== category) continue;
    out.shots_fired += r.shots_fired;
    out.shots_hit += r.shots_hit;
    out.headshot_hits += r.headshot_hits;
    out.damage_dealt += r.damage_dealt;
    out.rounds_played += r.rounds_played;
  }
  return out;
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
