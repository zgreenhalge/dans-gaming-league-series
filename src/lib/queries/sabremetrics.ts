import { supabase } from '../supabase';
import type { SabFieldsWithDerived, PlayerMatchSabremetrics, Faction } from '../types';
import { getPlayersById } from './player';
import { resolveMatchSeasons, fetchAllPages, asPage } from './_shared';
import {
  getAllKillCreditFlags, deriveKillCreditCounts, deriveSideSplitCounts, deriveClutchCounts,
  buildPlayerFactionsAndRoster, lookupDerivedSabFields,
} from './kills';
import { deriveAccuracyTotals } from './weaponStats';
import { getRoundSides } from './rounds';
import { getAllUtilityThrows, deriveUtilityCounts } from './utility';


export interface SabremetricMatchRow {
  player_id: number;
  player_name: string;
  match_id: number;
  season_id: number;
  is_gauntlet: boolean;
  rounds_played: number;
  sab: SabFieldsWithDerived;
}

/** All sabremetrics, or (with `seasonId`) just one season's — same join, filtered at the end so
 *  season-scoped callers (the season page) can't drift from the career-wide one.
 *
 *  `headshot_kills`, `teamkills`, `opening_kills`, `opening_deaths`, `two_k_rounds`, `shots_fired`,
 *  `shots_hit`, `headshot_hits`, `kills_ct`/`_t`, `deaths_ct`/`_t`, `assists_ct`/`_t`,
 *  `headshot_kills_ct`/`_t`, `clutch_1v1`/`1v2`/`2v1_attempts`/`wins`, and `flash_assists`/
 *  `teamflash_duration`/`enemies_flashed`/`flashes_leading_to_kill`/`effective_flashes`/
 *  `blind_duration_dealt`/`blind_duration_max_sum` are overwritten with the `derive*()` helpers'
 *  results rather than read off the stored `player_match_sabremetrics` row — all were exact
 *  duplicates of (or directly reconstructible from) `match_kills`/`player_match_weapon_stats`/
 *  `match_rounds`/`match_utility_throws`, so those are now the source of truth for them
 *  (#457/#488/#489). */
export async function getAllSabremetrics(seasonId?: number): Promise<SabremetricMatchRow[]> {
  // pmsRows shared as one promise (not fetched again per consumer) so deriveAccuracyTotals()'s and
  // getAllKillCreditFlags()'s own internal `player_match_stats` reads don't duplicate the fetch
  // below already needs. getAllKillCreditFlags() (unlike getAllMatchKills()) needs no season
  // resolution or player-name join — deriveKillCreditCounts() reads nothing else — so it doesn't
  // need playersByIdPromise either. `faction` is included so the same fetch also feeds
  // deriveSideSplitCounts()'s playerFactions map, rather than a separate `player_match_stats` read.
  const playersByIdPromise = getPlayersById();
  const pmsRowsPromise = fetchAllPages<
    { id: number; player_id: number; match_id: number; rounds_played: number; faction: Faction }
  >(
    (from, to) => asPage(
      supabase.from('player_match_stats').select('id, player_id, match_id, rounds_played, faction').range(from, to),
    ),
  );

  const [
    sabRows,
    pmsRows,
    { data: seasonRows, error: seasonErr },
    matchSeason,
    playersById,
    kills,
    accuracyTotals,
    roundSides,
    throws,
  ] = await Promise.all([
    fetchAllPages<PlayerMatchSabremetrics>((from, to) =>
      supabase.from('player_match_sabremetrics').select('*').range(from, to),
    ),
    pmsRowsPromise,
    supabase.from('seasons').select('id, is_gauntlet'),
    resolveMatchSeasons(),
    playersByIdPromise,
    getAllKillCreditFlags(pmsRowsPromise),
    deriveAccuracyTotals(undefined, pmsRowsPromise),
    getRoundSides(),
    getAllUtilityThrows(undefined, pmsRowsPromise),
  ]);
  if (seasonErr) throw seasonErr;

  const seasonIsGauntlet = new Map<number, boolean>();
  for (const s of (seasonRows ?? []) as { id: number; is_gauntlet: boolean }[])
    seasonIsGauntlet.set(s.id, s.is_gauntlet);

  const pmsLookup = new Map<number, { player_id: number; match_id: number; rounds_played: number }>();
  for (const r of pmsRows) pmsLookup.set(r.id, r);
  const { playerFactions, rosterByMatch } = buildPlayerFactionsAndRoster(pmsRows);

  const creditCounts = deriveKillCreditCounts(kills);
  const sideSplitCounts = deriveSideSplitCounts(kills, roundSides, playerFactions);
  const clutchCounts = deriveClutchCounts(kills, roundSides, playerFactions, rosterByMatch);
  const utilityCounts = deriveUtilityCounts(throws, kills, playerFactions);

  const result: SabremetricMatchRow[] = [];
  for (const raw of sabRows) {
    const pms = pmsLookup.get(raw.player_match_stats_id);
    if (!pms) continue;
    const sid = matchSeason.get(pms.match_id);
    if (sid == null) continue;
    if (seasonId != null && sid !== seasonId) continue;
    const player = playersById.get(pms.player_id);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { player_match_stats_id: _, ...rest } = raw;
    const key = `${pms.match_id}:${pms.player_id}`;
    const sab: SabFieldsWithDerived = {
      ...rest,
      ...lookupDerivedSabFields(key, creditCounts, accuracyTotals, sideSplitCounts, clutchCounts, utilityCounts),
    };
    result.push({
      player_id: pms.player_id,
      player_name: player?.name ?? `#${pms.player_id}`,
      match_id: pms.match_id,
      season_id: sid,
      is_gauntlet: seasonIsGauntlet.get(sid) ?? false,
      rounds_played: pms.rounds_played,
      sab,
    });
  }
  return result;
}

/** Adds every field of `b` into `a` in place via `Object.keys()` rather than per-field
 *  enumeration — the shared accumulation primitive behind every sabremetric total in this
 *  codebase, used directly by `SabremetricsLeaderboardView`'s `aggregateRows()` (one accumulator
 *  per player, mutated per match row) and via `sumSabFields()` below for season/career totals. */
export function addSabFields(a: SabFieldsWithDerived, b: SabFieldsWithDerived): void {
  for (const key of Object.keys(b) as (keyof SabFieldsWithDerived)[]) {
    a[key] += b[key];
  }
}

function sumSabFields(a: SabFieldsWithDerived, b: SabFieldsWithDerived): SabFieldsWithDerived {
  const result = { ...a };
  addSabFields(result, b);
  return result;
}

/**
 * Per-season sabremetric totals — one row per (player, season), with `sab` fields and
 * `rounds_played` summed across all of that player's matches in the season. Same shape as
 * `SabremetricMatchRow` (`match_id` is set to `season_id`, since there's exactly one row per
 * player per season and no real match_id exists at this grain) so it's a drop-in replacement
 * anywhere a caller only needs per-player totals — the Plus-stat league baseline or a
 * season-filtered leaderboard — rather than true per-match rows. `SabremetricsLeaderboardView`
 * (the only consumer) never reads `match_id` for anything but a distinct-match count that isn't
 * displayed, so this loses no information any caller actually uses.
 *
 * Ships O(players × seasons) instead of O(players × matches) to the client, which is what keeps
 * the player and statistics pages' RSC payload bounded as demo ingestion fills in every match.
 */
export async function getSabremetricSeasonTotals(seasonId?: number): Promise<SabremetricMatchRow[]> {
  const perMatch = await getAllSabremetrics(seasonId);
  const byPlayerSeason = new Map<string, SabremetricMatchRow>();
  for (const row of perMatch) {
    const key = `${row.player_id}:${row.season_id}`;
    const existing = byPlayerSeason.get(key);
    if (!existing) {
      byPlayerSeason.set(key, { ...row, match_id: row.season_id, sab: { ...row.sab } });
      continue;
    }
    existing.rounds_played += row.rounds_played;
    existing.sab = sumSabFields(existing.sab, row.sab);
  }
  return Array.from(byPlayerSeason.values());
}

// --- Plus-stat composite (1-scaled: 1.00 = league average) ---
//
// Shared by SabremetricsLeaderboardView.tsx (the live Stats Plus leaderboard) and
// scripts/match-context.ts (the chirp-skill JSON report) so the two can't drift apart the way they
// once did (#163) — the script's own copy had gone stale against an already-superseded Utility+
// formula and used different zero-denominator fallbacks.

/**
 * The fields a per-match sabremetric row needs for `aggregateRows()` — a structural subset of
 * `SabremetricMatchRow` above, so season/career callers (which pass full `SabremetricMatchRow[]`)
 * satisfy this without any change, and match-page callers can build a lighter-weight row (no
 * season_id/is_gauntlet, which aggregation never uses) from per-match data.
 */
export interface SabremetricStatRow {
  player_id: number;
  player_name: string;
  match_id: number;
  rounds_played: number;
  sab: SabFieldsWithDerived;
}

// Every sabremetric field `AggregatedSab` needs beyond the ct/t split is identical in name and
// type to its `SabFieldsWithDerived` counterpart, so the bulk of the shape is inherited from
// `SabFieldsWithDerived` itself (`Omit`ing the ct/t-split raw fields aggregateRows() unions into
// `kills`/`deaths`/etc., plus the three fields this view never reads) rather than re-listing every
// stat by hand — the single source of truth for "what sabremetrics exist" stays `SabFields`/
// `SabFieldsWithDerived` in src/lib/types.ts. A new flat field needs no changes here; a new ct/t-split
// field needs adding to this list AND to the matching destructure in aggregateRows() below, or it
// silently lands as two unsummed raw columns instead of a unioned total.
type DerivedRawSabFields =
  | 'kills_ct' | 'kills_t' | 'deaths_ct' | 'deaths_t'
  | 'assists_ct' | 'assists_t' | 'damage_ct' | 'damage_t'
  | 'headshot_kills_ct' | 'headshot_kills_t' | 'blind_duration_dealt';

export interface AggregatedSab extends Omit<SabFieldsWithDerived, DerivedRawSabFields> {
  player_id: number;
  player_name: string;
  matches: number;
  rounds_played: number;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
}

interface PlayerMeta {
  player_name: string;
  matches: number;
  rounds_played: number;
  seenMatchIds: Set<number>;
}

/** Accumulates raw per-match `sab` totals via the generic `addSabFields()` (one accumulator per
 *  player, mutated in place per row — same primitive `getSabremetricSeasonTotals()` builds its
 *  own `sumSabFields()` on), then flattens to `AggregatedSab`'s shape once per player at the end —
 *  so the accumulation step needs no field-shape knowledge at all, and only the final flatten
 *  touches `DerivedRawSabFields`. */
export function aggregateRows(rows: SabremetricStatRow[]): AggregatedSab[] {
  const rawByPlayer = new Map<number, SabFieldsWithDerived>();
  const meta = new Map<number, PlayerMeta>();

  for (const r of rows) {
    const prevRaw = rawByPlayer.get(r.player_id);
    if (prevRaw) {
      addSabFields(prevRaw, r.sab);
    } else {
      rawByPlayer.set(r.player_id, { ...r.sab });
    }

    let m = meta.get(r.player_id);
    if (!m) {
      m = { player_name: r.player_name, matches: 0, rounds_played: 0, seenMatchIds: new Set() };
      meta.set(r.player_id, m);
    }
    if (!m.seenMatchIds.has(r.match_id)) {
      m.seenMatchIds.add(r.match_id);
      m.matches++;
    }
    m.rounds_played += r.rounds_played;
  }

  return Array.from(rawByPlayer, ([player_id, raw]): AggregatedSab => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { kills_ct, kills_t, deaths_ct, deaths_t, assists_ct, assists_t, damage_ct, damage_t, headshot_kills_ct, headshot_kills_t, blind_duration_dealt, ...shared } = raw;
    const { player_name, matches, rounds_played } = meta.get(player_id)!;
    return {
      player_id,
      player_name,
      matches,
      rounds_played,
      kills: kills_ct + kills_t,
      deaths: deaths_ct + deaths_t,
      assists: assists_ct + assists_t,
      damage: damage_ct + damage_t,
      ...shared,
    };
  });
}

/** General "league total X / league total Y" ratio, with a fallback (constant, or a function of
 *  the total numerator) for when the denominator is zero. The shared base for every Plus stat's
 *  league-average baseline — volume-weighted (totals over totals), so a low-volume player's own
 *  rate can't swing the average as hard as a high-volume one. */
export function leagueAvgRatio(
  all: AggregatedSab[],
  numKey: (a: AggregatedSab) => number,
  denKey: (a: AggregatedSab) => number,
  fallback: number | ((totalNum: number) => number) = 0,
): number {
  const totalNum = all.reduce((s, a) => s + numKey(a), 0);
  const totalDen = all.reduce((s, a) => s + denKey(a), 0);
  if (totalDen > 0) return totalNum / totalDen;
  return typeof fallback === 'function' ? fallback(totalNum) : fallback;
}

function plusStat(playerVal: number, avgVal: number): number {
  return avgVal > 0 ? playerVal / avgVal : 1;
}

export interface PlusStat {
  kpr: number;
  apr: number;
  dpr: number;
  adr: number;
  kdr: number;
  entry: number;
  kast: number;
  trade: number;
  objective: number;
  utility: number;
  clutch: number;
  choke: number;
  aim: number;
  spray: number;
}

/** Choke Score = 1v1 losses + 2×1v2 losses + 5×2v1 losses — the mirror of Clutch Score, weighted
 *  by how big the blown numbers advantage was. A "loss" is attempts minus wins for each bucket. */
export function chokeScore(a: AggregatedSab): number {
  return (a.clutch_1v1_attempts - a.clutch_1v1_wins)
    + 2 * (a.clutch_1v2_attempts - a.clutch_1v2_wins)
    + 5 * (a.clutch_2v1_attempts - a.clutch_2v1_wins);
}

export interface LeagueAverages {
  kpr: number; apr: number; dpr: number; adr: number; kdr: number;
  entry: number; kast: number; trade: number;
  objective: number; clutch: number; choke: number;
  accuracy: number; headAccuracy: number; counterStrafe: number; spray: number;
  flashAssists: number; utilDamage: number; blockingSmoke: number; teamflash: number;
}

/** Every league-wide baseline computePlusStats() needs, computed once per aggregated-player-list
 *  (not once per player) — walking `all` here instead of inside computePlusStats() is what keeps
 *  a leaderboard of n players O(n) instead of O(n²). */
export function computeLeagueAverages(all: AggregatedSab[]): LeagueAverages {
  const rounds = (a: AggregatedSab) => a.rounds_played;
  return {
    kpr: leagueAvgRatio(all, (a) => a.kills, rounds),
    apr: leagueAvgRatio(all, (a) => a.assists, rounds),
    dpr: leagueAvgRatio(all, (a) => a.deaths, rounds),
    adr: leagueAvgRatio(all, (a) => a.damage, rounds),
    kdr: leagueAvgRatio(all, (a) => a.kills, (a) => a.deaths, (totalKills) => totalKills),
    entry: leagueAvgRatio(all, (a) => a.opening_kills, (a) => a.opening_kills + a.opening_deaths, 0.5),
    kast: leagueAvgRatio(all, (a) => a.kast_rounds, rounds),
    trade: leagueAvgRatio(all, (a) => a.trade_kill_successes, (a) => a.trade_kill_attempts),
    objective: leagueAvgRatio(all, (a) => 2 * a.plants + 3 * a.defuses, rounds),
    clutch: leagueAvgRatio(all, (a) => a.clutch_1v1_wins + 3 * a.clutch_1v2_wins, rounds),
    choke: leagueAvgRatio(all, chokeScore, rounds),
    accuracy: leagueAvgRatio(all, (a) => a.shots_hit, (a) => a.shots_fired),
    headAccuracy: leagueAvgRatio(all, (a) => a.headshot_hits_no_awp, (a) => a.shots_hit_no_awp),
    counterStrafe: leagueAvgRatio(all, (a) => a.counter_strafe_good_shots, (a) => a.counter_strafe_shots),
    spray: leagueAvgRatio(all, (a) => a.spray_shots_hit, (a) => a.spray_shots_fired),
    flashAssists: leagueAvgRatio(all, (a) => a.flash_assists, rounds),
    utilDamage: leagueAvgRatio(all, (a) => a.utility_damage, rounds),
    blockingSmoke: leagueAvgRatio(all, (a) => a.smokes_blocking_push, (a) => a.ct_smokes_thrown),
    teamflash: leagueAvgRatio(all, (a) => a.teamflash_duration, rounds),
  };
}

export function computePlusStats(agg: AggregatedSab, la: LeagueAverages): PlusStat {
  const rp = agg.rounds_played || 1;

  // Aim+ averages three already-normalized ratios (Accuracy+, Head Accuracy+, Counter-Strafe+)
  // rather than summing raw percentages — they're fairly orthogonal skills on different
  // denominators, so there's no principled point-scale to weight them on directly, but each is
  // already "1.00 = league average" once ratio'd, so averaging those is apples-to-apples.
  const accuracyPlus = plusStat(agg.shots_fired > 0 ? agg.shots_hit / agg.shots_fired : 0, la.accuracy);
  const headAccuracyPlus = plusStat(
    agg.shots_hit_no_awp > 0 ? agg.headshot_hits_no_awp / agg.shots_hit_no_awp : 0,
    la.headAccuracy,
  );
  const counterStrafePlus = plusStat(
    agg.counter_strafe_shots > 0 ? agg.counter_strafe_good_shots / agg.counter_strafe_shots : 0,
    la.counterStrafe,
  );

  // Utility+ averages four already-normalized ratios the same way Aim+ does, rather than a
  // contrived raw-point score (flash assists + util damage/50 + smokes blocking - teamflash) whose
  // league average could land near zero and blow up the ratio. Teamflash duration is "lower is
  // better", so its ratio is folded in inverted (2 - teamflashPlus) to keep it on the same
  // "1.00 = average" scale as the other three before weighting.
  const flashAssistsPlus = plusStat(agg.flash_assists / rp, la.flashAssists);
  const utilDamagePlus = plusStat(agg.utility_damage / rp, la.utilDamage);
  const blockingSmokePlus = plusStat(
    agg.ct_smokes_thrown > 0 ? agg.smokes_blocking_push / agg.ct_smokes_thrown : 0,
    la.blockingSmoke,
  );
  const teamflashPlus = plusStat(agg.teamflash_duration / rp, la.teamflash);

  return {
    kpr: plusStat(agg.kills / rp, la.kpr),
    apr: plusStat(agg.assists / rp, la.apr),
    dpr: plusStat(agg.deaths / rp, la.dpr),
    adr: plusStat(agg.damage / rp, la.adr),
    kdr: plusStat(agg.deaths > 0 ? agg.kills / agg.deaths : agg.kills, la.kdr),
    entry: plusStat(
      (agg.opening_kills + agg.opening_deaths) > 0
        ? agg.opening_kills / (agg.opening_kills + agg.opening_deaths)
        : 0,
      la.entry,
    ),
    kast: plusStat(agg.kast_rounds / rp, la.kast),
    trade: plusStat(
      agg.trade_kill_attempts > 0 ? agg.trade_kill_successes / agg.trade_kill_attempts : 0,
      la.trade,
    ),
    objective: plusStat((2 * agg.plants + 3 * agg.defuses) / rp, la.objective),
    utility: 0.30 * flashAssistsPlus + 0.30 * utilDamagePlus + 0.20 * blockingSmokePlus
      + 0.20 * (2 - teamflashPlus),
    clutch: plusStat((agg.clutch_1v1_wins + 3 * agg.clutch_1v2_wins) / rp, la.clutch),
    choke: plusStat(chokeScore(agg) / rp, la.choke),
    aim: 0.35 * accuracyPlus + 0.40 * headAccuracyPlus + 0.25 * counterStrafePlus,
    spray: plusStat(agg.spray_shots_fired > 0 ? agg.spray_shots_hit / agg.spray_shots_fired : 0, la.spray),
  };
}
