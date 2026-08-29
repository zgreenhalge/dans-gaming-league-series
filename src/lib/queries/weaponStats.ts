import { supabase } from '../supabase';
import type { PlayerMatchWeaponStat, PlayerMatchEconomyStat, WeaponStatFields, Player, Faction } from '../types';
import { getPlayersById } from './player';
import { resolveMatchSeasons, fetchAllPages, fetchPmsLookup, asPage, type PmsRow } from './_shared';
import { WEAPON_CATEGORY, type WeaponCategory } from '../parsers/weaponClasses';
import { resolveSide } from '../parsers/roundSides';

export interface WeaponClassMatchRow extends WeaponStatFields {
  player_id: number;
  player_name: string;
  match_id: number;
  season_id: number;
  /** The exact weapon this row is for (#474), e.g. `ak47` — `null` only for a row from a match not
   *  yet reparsed since this column was added; such rows still roll up correctly into
   *  `weapon_category`, they just can't answer a per-weapon-specific selection until reparsed. */
  weapon: string | null;
  /** Derived from `weapon` via `WEAPON_CATEGORY` when present; falls back to the row's own stored
   *  category for a pre-reparse row with no `weapon` (#474 phase 1 — see the migration's own
   *  comment for why that column stays live during this transition). #499 tracks dropping the
   *  stored `weapon_category` column (and this fallback) once every match is confirmed reparsed. */
  weapon_category: WeaponCategory;
}

export interface EconomyMatchRow extends WeaponStatFields {
  player_id: number;
  player_name: string;
  match_id: number;
  season_id: number;
  economy_type: string;
  /** Rounds at this tier this player's side actually won — from `match_round_economy` joined to
   *  each round's own winner (`getEconomyRoundWins()` below), not derivable from `rounds_played`
   *  alone. */
  rounds_won: number;
}

interface JoinedFields {
  player_id: number;
  player_name: string;
  match_id: number;
  season_id: number;
}

/** Shared by `getAllWeaponClassStats()`/`getAllEconomyStats()` — same `player_match_stats` join and
 *  season-scoping, differing only in which table is read and how its bucket column(s) get shaped
 *  into the caller's own row type (weapon-class derives a category from `weapon`; economy has a
 *  single stored `economy_type` bucket already). `seasonId` filters to a single season the same way
 *  `getAllSabremetrics()` does. Pass `playersById`/`pmsRows` when the caller already fetched them
 *  (e.g. alongside `getAllMatchKills()`) to skip a redundant full `players`/`player_match_stats`
 *  table read — same convention `getAllMatchKills()` uses, via the same `fetchPmsLookup()` helper. */
async function getAllJoinedStats<Raw extends { player_match_stats_id: number }>(
  table: 'player_match_weapon_stats' | 'player_match_economy_stats',
  seasonId: number | undefined,
  playersById: Map<number, Player> | Promise<Map<number, Player>> | undefined,
  pmsRows?: PmsRow[] | Promise<PmsRow[]>,
): Promise<(JoinedFields & { raw: Raw })[]> {
  const [rows, pmsLookup, matchSeason, resolvedPlayersById] = await Promise.all([
    // `asPage()` erases the union `table` string can't otherwise resolve `Raw` against (same
    // reasoning `replaceMatchRows()` in `demo/factTables.ts` gives for its own untyped view) —
    // callers stay fully typed since `Raw` is always a fixed type argument, not inferred here.
    fetchAllPages<Raw>((from, to) => asPage(supabase.from(table).select('*').range(from, to))),
    fetchPmsLookup(undefined, pmsRows),
    resolveMatchSeasons(),
    playersById ? Promise.resolve(playersById) : getPlayersById(),
  ]);

  const result: (JoinedFields & { raw: Raw })[] = [];
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
      raw,
    });
  }
  return result;
}

/** Resolves a joined `player_match_weapon_stats` row's `weapon`/`weapon_category` fields (#474) —
 *  shared by `getAllWeaponClassStats()` and `getMatchWeaponClassStats()` so both derive category
 *  from `weapon` the same way, falling back to the row's own stored category only when `weapon`
 *  hasn't been backfilled yet. */
function resolveWeaponAndCategory(raw: PlayerMatchWeaponStat): { weapon: string | null; weapon_category: WeaponCategory } {
  const derived = raw.weapon != null ? WEAPON_CATEGORY[raw.weapon] : undefined;
  return { weapon: raw.weapon, weapon_category: derived ?? (raw.weapon_category as WeaponCategory) };
}

/** Per-weapon shot/accuracy/damage/rounds breakdown (#279, #474), one row per (player, match,
 *  weapon). Pass `playersById`/`pmsRows` when the caller already fetched them (e.g. shared with an
 *  adjacent `getAllMatchKills()` call) to skip a redundant full `players`/`player_match_stats`
 *  table read. */
export async function getAllWeaponClassStats(
  seasonId?: number,
  playersById?: Map<number, Player> | Promise<Map<number, Player>>,
  pmsRows?: PmsRow[] | Promise<PmsRow[]>,
): Promise<WeaponClassMatchRow[]> {
  const rows = await getAllJoinedStats<PlayerMatchWeaponStat>('player_match_weapon_stats', seasonId, playersById, pmsRows);
  return rows.map(({ raw, ...join }) => ({
    ...join,
    ...resolveWeaponAndCategory(raw),
    shots_fired: raw.shots_fired,
    shots_hit: raw.shots_hit,
    headshot_hits: raw.headshot_hits,
    damage_dealt: raw.damage_dealt,
    rounds_played: raw.rounds_played,
  }));
}

type RawRoundEconomyRow = { match_id: number; round_number: number; player_match_stats_id: number; economy_type: string };
type RawRoundWinRow = { match_id: number; round_number: number; shirts_side: string; winner_side: string };
type RawPmsFactionRow = { id: number; player_id: number; match_id: number; faction: Faction };

/** Per `` `${match_id}:${player_id}:${economy_type}` `` rounds actually WON, from
 *  `match_round_economy` joined to each round's own winner (`match_rounds`) — the round-level
 *  ground truth `player_match_economy_stats` doesn't carry itself (it only sums `rounds_played` per
 *  tier, never how many of those were won). Resolves each round's side the same way
 *  `deriveSideSplitCounts()`/`deriveClutchCounts()` (`queries/kills.ts`) do, but fetched
 *  independently here (rather than importing those helpers) since `kills.ts` already imports from
 *  this file — importing back would be circular. */
async function getEconomyRoundWins(): Promise<Map<string, number>> {
  const [roundEconomyRows, roundRows, pmsRows] = await Promise.all([
    fetchAllPages<RawRoundEconomyRow>((from, to) =>
      asPage(supabase.from('match_round_economy').select('match_id, round_number, player_match_stats_id, economy_type').range(from, to)),
    ),
    fetchAllPages<RawRoundWinRow>((from, to) =>
      asPage(supabase.from('match_rounds').select('match_id, round_number, shirts_side, winner_side').range(from, to)),
    ),
    fetchAllPages<RawPmsFactionRow>((from, to) =>
      asPage(supabase.from('player_match_stats').select('id, player_id, match_id, faction').range(from, to)),
    ),
  ]);

  const pmsById = new Map(pmsRows.map((r) => [r.id, r]));
  const roundOutcomeByKey = new Map<string, { shirtsSide: 'CT' | 'T'; winnerSide: 'CT' | 'T' }>();
  for (const r of roundRows) {
    roundOutcomeByKey.set(`${r.match_id}:${r.round_number}`, {
      shirtsSide: r.shirts_side as 'CT' | 'T',
      winnerSide: r.winner_side as 'CT' | 'T',
    });
  }

  const out = new Map<string, number>();
  for (const r of roundEconomyRows) {
    const pms = pmsById.get(r.player_match_stats_id);
    if (!pms) continue;
    const outcome = roundOutcomeByKey.get(`${r.match_id}:${r.round_number}`);
    if (!outcome) continue;
    if (resolveSide(outcome.shirtsSide, pms.faction) !== outcome.winnerSide) continue;
    const key = `${r.match_id}:${pms.player_id}:${r.economy_type}`;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/** Per-round-economy shot/accuracy/damage/rounds breakdown (#279), one row per (player, match,
 *  economy_type). Pass `playersById`/`pmsRows` when the caller already fetched them (e.g. shared
 *  with an adjacent `getAllMatchKills()` call) to skip a redundant full `players`/`player_match_stats`
 *  table read. */
export async function getAllEconomyStats(
  seasonId?: number,
  playersById?: Map<number, Player> | Promise<Map<number, Player>>,
  pmsRows?: PmsRow[] | Promise<PmsRow[]>,
): Promise<EconomyMatchRow[]> {
  const [rows, roundWins] = await Promise.all([
    getAllJoinedStats<PlayerMatchEconomyStat>('player_match_economy_stats', seasonId, playersById, pmsRows),
    getEconomyRoundWins(),
  ]);
  return rows.map(({ raw, ...join }) => ({
    ...join,
    economy_type: raw.economy_type,
    shots_fired: raw.shots_fired,
    shots_hit: raw.shots_hit,
    headshot_hits: raw.headshot_hits,
    damage_dealt: raw.damage_dealt,
    rounds_played: raw.rounds_played,
    rounds_won: roundWins.get(`${join.match_id}:${join.player_id}:${raw.economy_type}`) ?? 0,
  }));
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
      ...resolveWeaponAndCategory(raw),
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
 *  cross-match *sum* (`groupWeaponAccuracyByPlayer()`'s result), never a single stored row, but the
 *  shape is identical so there's no reason to redeclare it. */
export type WeaponClassAggregateStat = WeaponStatFields;

/** The zeroed shape a player/weapon/category combination with no rows falls back to — exported so
 *  a `groupWeaponAccuracyByPlayer()` miss (`SabremetricsLeaderboardView.tsx`) can default to the
 *  same shape a real sum would have. */
export const ZERO_WEAPON_CLASS_STAT: WeaponClassAggregateStat = {
  shots_fired: 0, shots_hit: 0, headshot_hits: 0, damage_dealt: 0, rounds_played: 0,
};

/** One player's weapon-class accuracy, resolvable either by exact weapon or by whole category —
 *  `resolveWeaponFilterStat()` (`kills.ts`) needs both: a favorite/specific-weapon filter looks up
 *  `byWeapon`, a category filter looks up `byCategory`. */
export interface PlayerWeaponAccuracy {
  byWeapon: Map<string, WeaponClassAggregateStat>;
  byCategory: Map<WeaponCategory, WeaponClassAggregateStat>;
}

function addWeaponClassStat<K>(map: Map<K, WeaponClassAggregateStat>, key: K, r: WeaponClassMatchRow): void {
  let c = map.get(key);
  if (!c) {
    c = { ...ZERO_WEAPON_CLASS_STAT };
    map.set(key, c);
  }
  c.shots_fired += r.shots_fired;
  c.shots_hit += r.shots_hit;
  c.headshot_hits += r.headshot_hits;
  c.damage_dealt += r.damage_dealt;
  c.rounds_played += r.rounds_played;
}

/** Sums every player's `WeaponClassMatchRow`s into per-player `PlayerWeaponAccuracy` — both by
 *  exact weapon and by whole category — across every match in whatever scope the caller already
 *  fetched `rows` for (a season, career), in a single pass over `rows` regardless of how many
 *  players or weapons/categories end up queried against the result (#474). A multi-player table
 *  calls this once per render and looks each row up in O(1), rather than rescanning `rows` once per
 *  player. Rows with `weapon === null` (not yet backfilled, see `WeaponClassMatchRow`) still count
 *  toward `byCategory` — only `byWeapon` misses them. */
export function groupWeaponAccuracyByPlayer(rows: WeaponClassMatchRow[]): Map<number, PlayerWeaponAccuracy> {
  const out = new Map<number, PlayerWeaponAccuracy>();
  for (const r of rows) {
    let p = out.get(r.player_id);
    if (!p) {
      p = { byWeapon: new Map(), byCategory: new Map() };
      out.set(r.player_id, p);
    }
    if (r.weapon != null) addWeaponClassStat(p.byWeapon, r.weapon, r);
    addWeaponClassStat(p.byCategory, r.weapon_category, r);
  }
  return out;
}

export interface EconomyTierStat extends WeaponStatFields {
  economy_type: string;
  /** Rounds at this tier this player's side actually won — see `EconomyMatchRow.rounds_won`. */
  rounds_won: number;
}

/** The shape an economy tier starts at before any match row is summed into it
 *  (`aggregateEconomyStats()`), and the same shape `resolveEconomyStat()` falls back to for a tier
 *  this player never played a round of — so both build one from the same place instead of
 *  duplicating the field list. */
function zeroEconomyStat(economyType: string): EconomyTierStat {
  return { economy_type: economyType, shots_fired: 0, shots_hit: 0, headshot_hits: 0, damage_dealt: 0, rounds_played: 0, rounds_won: 0 };
}

/** Per-player, per-economy-tier shot/accuracy/damage/rounds totals, summed across every
 *  `EconomyMatchRow` in scope — the Economy sub-tab's analog of `kills.ts`'s
 *  `aggregateWeaponKillStats()`, reusing `player_match_economy_stats`' own bucketed totals rather
 *  than re-deriving them from raw events. */
export function aggregateEconomyStats(rows: EconomyMatchRow[], playerId: number): EconomyTierStat[] {
  const buckets = new Map<string, EconomyTierStat>();
  for (const r of rows) {
    if (r.player_id !== playerId) continue;
    let b = buckets.get(r.economy_type);
    if (!b) {
      b = zeroEconomyStat(r.economy_type);
      buckets.set(r.economy_type, b);
    }
    b.shots_fired += r.shots_fired;
    b.shots_hit += r.shots_hit;
    b.headshot_hits += r.headshot_hits;
    b.damage_dealt += r.damage_dealt;
    b.rounds_played += r.rounds_played;
    b.rounds_won += r.rounds_won;
  }
  return Array.from(buckets.values());
}

/** Resolves one tier from an aggregated per-player breakdown — an explicit `economyType` picks
 *  that bucket (zeroed if the player never played a round of it), `null` picks whichever tier this
 *  player played the most rounds in, mirroring `resolveWeaponStat()`'s favorite-weapon default for
 *  the Weapons sub-tab. */
export function resolveEconomyStat(stats: EconomyTierStat[], economyType: string | null): EconomyTierStat {
  if (economyType != null) return stats.find((s) => s.economy_type === economyType) ?? zeroEconomyStat(economyType);
  return stats.reduce<EconomyTierStat>((best, s) => (s.rounds_played > best.rounds_played ? s : best), zeroEconomyStat('eco'));
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
