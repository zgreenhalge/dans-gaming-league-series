import { supabase } from '../supabase';
import type { PlayerMatchWeaponStat, PlayerMatchEconomyStat } from '../types';
import { isPlayedScore } from '../util';
import { getPlayersById } from './player';

export interface WeaponClassMatchRow {
  player_id: number;
  player_name: string;
  match_id: number;
  season_id: number;
  weapon_category: string;
  shots_fired: number;
  shots_hit: number;
  headshot_hits: number;
  damage_dealt: number;
  rounds_played: number;
}

export interface EconomyMatchRow {
  player_id: number;
  player_name: string;
  match_id: number;
  season_id: number;
  economy_type: string;
  shots_fired: number;
  shots_hit: number;
  headshot_hits: number;
  damage_dealt: number;
  rounds_played: number;
}

/** Shared match_id -> season_id resolution, the same join `getAllSabremetrics()` uses — every
 *  breakdown row is dropped unless it belongs to an actually-played match. */
async function resolveMatchSeasons(): Promise<Map<number, number>> {
  const [{ data: matchRows, error: matchErr }, { data: weekRows, error: weekErr }] = await Promise.all([
    supabase.from('matches').select('id, week_id, final_score'),
    supabase.from('weeks').select('id, season_id'),
  ]);
  if (matchErr) throw matchErr;
  if (weekErr) throw weekErr;

  const weekToSeason = new Map<number, number>();
  for (const w of (weekRows ?? []) as { id: number; season_id: number }[])
    weekToSeason.set(w.id, w.season_id);

  const matchSeason = new Map<number, number>();
  for (const m of (matchRows ?? []) as { id: number; week_id: number; final_score: string | null }[]) {
    if (!isPlayedScore(m.final_score)) continue;
    const sid = weekToSeason.get(m.week_id);
    if (sid != null) matchSeason.set(m.id, sid);
  }
  return matchSeason;
}

/** Per-weapon-category shot/accuracy/damage/rounds breakdown (#279), one row per (player, match,
 *  weapon_category). `seasonId` filters to a single season the same way `getAllSabremetrics()` does. */
export async function getAllWeaponClassStats(seasonId?: number): Promise<WeaponClassMatchRow[]> {
  const [{ data: rows, error }, { data: pmsRows, error: pmsErr }, matchSeason, playersById] = await Promise.all([
    supabase.from('player_match_weapon_stats').select('*'),
    supabase.from('player_match_stats').select('id, player_id, match_id'),
    resolveMatchSeasons(),
    getPlayersById(),
  ]);
  if (error) throw error;
  if (pmsErr) throw pmsErr;

  const pmsLookup = new Map<number, { player_id: number; match_id: number }>();
  for (const r of (pmsRows ?? []) as { id: number; player_id: number; match_id: number }[])
    pmsLookup.set(r.id, r);

  const result: WeaponClassMatchRow[] = [];
  for (const raw of (rows ?? []) as PlayerMatchWeaponStat[]) {
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

/** Per-round-economy shot/accuracy/damage/rounds breakdown (#279), one row per (player, match,
 *  economy_type). `seasonId` filters to a single season the same way `getAllSabremetrics()` does. */
export async function getAllEconomyStats(seasonId?: number): Promise<EconomyMatchRow[]> {
  const [{ data: rows, error }, { data: pmsRows, error: pmsErr }, matchSeason, playersById] = await Promise.all([
    supabase.from('player_match_economy_stats').select('*'),
    supabase.from('player_match_stats').select('id, player_id, match_id'),
    resolveMatchSeasons(),
    getPlayersById(),
  ]);
  if (error) throw error;
  if (pmsErr) throw pmsErr;

  const pmsLookup = new Map<number, { player_id: number; match_id: number }>();
  for (const r of (pmsRows ?? []) as { id: number; player_id: number; match_id: number }[])
    pmsLookup.set(r.id, r);

  const result: EconomyMatchRow[] = [];
  for (const raw of (rows ?? []) as PlayerMatchEconomyStat[]) {
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
      economy_type: raw.economy_type,
      shots_fired: raw.shots_fired,
      shots_hit: raw.shots_hit,
      headshot_hits: raw.headshot_hits,
      damage_dealt: raw.damage_dealt,
      rounds_played: raw.rounds_played,
    });
  }
  return result;
}
