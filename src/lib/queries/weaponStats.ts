import { supabase } from '../supabase';
import type { PlayerMatchWeaponStat, PlayerMatchEconomyStat, WeaponStatFields } from '../types';
import { getPlayersById } from './player';
import { resolveMatchSeasons } from './_shared';

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
  const [{ data: rows, error }, { data: pmsRows, error: pmsErr }, matchSeason, playersById] = await Promise.all([
    supabase.from(table).select('*'),
    supabase.from('player_match_stats').select('id, player_id, match_id'),
    resolveMatchSeasons(),
    getPlayersById(),
  ]);
  if (error) throw error;
  if (pmsErr) throw pmsErr;

  const pmsLookup = new Map<number, { player_id: number; match_id: number }>();
  for (const r of (pmsRows ?? []) as { id: number; player_id: number; match_id: number }[])
    pmsLookup.set(r.id, r);

  const result: BreakdownRow[] = [];
  for (const raw of (rows ?? []) as (PlayerMatchWeaponStat | PlayerMatchEconomyStat)[]) {
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
