import { supabase } from '../supabase';
import type { SabFields, PlayerMatchSabremetrics } from '../types';
import { isPlayedScore } from '../util';
import { getPlayersById } from './player';


export interface SabremetricMatchRow {
  player_id: number;
  player_name: string;
  match_id: number;
  season_id: number;
  is_gauntlet: boolean;
  rounds_played: number;
  sab: SabFields;
}

/** All sabremetrics, or (with `seasonId`) just one season's — same join, filtered at the end so
 *  season-scoped callers (the season page) can't drift from the career-wide one. */
export async function getAllSabremetrics(seasonId?: number): Promise<SabremetricMatchRow[]> {
  const [
    { data: sabRows, error: sabErr },
    { data: pmsRows, error: pmsErr },
    { data: matchRows, error: matchErr },
    { data: weekRows, error: weekErr },
    { data: seasonRows, error: seasonErr },
    playersById,
  ] = await Promise.all([
    supabase.from('player_match_sabremetrics').select('*'),
    supabase.from('player_match_stats').select('id, player_id, match_id, rounds_played'),
    supabase.from('matches').select('id, week_id, final_score'),
    supabase.from('weeks').select('id, season_id'),
    supabase.from('seasons').select('id, is_gauntlet'),
    getPlayersById(),
  ]);
  if (sabErr) throw sabErr;
  if (pmsErr) throw pmsErr;
  if (matchErr) throw matchErr;
  if (weekErr) throw weekErr;
  if (seasonErr) throw seasonErr;

  const weekToSeason = new Map<number, number>();
  for (const w of (weekRows ?? []) as { id: number; season_id: number }[])
    weekToSeason.set(w.id, w.season_id);

  const seasonIsGauntlet = new Map<number, boolean>();
  for (const s of (seasonRows ?? []) as { id: number; is_gauntlet: boolean }[])
    seasonIsGauntlet.set(s.id, s.is_gauntlet);

  const matchSeason = new Map<number, number>();
  for (const m of (matchRows ?? []) as { id: number; week_id: number; final_score: string | null }[]) {
    if (!isPlayedScore(m.final_score)) continue;
    const sid = weekToSeason.get(m.week_id);
    if (sid != null) matchSeason.set(m.id, sid);
  }

  const pmsLookup = new Map<number, { player_id: number; match_id: number; rounds_played: number }>();
  for (const r of (pmsRows ?? []) as { id: number; player_id: number; match_id: number; rounds_played: number }[])
    pmsLookup.set(r.id, r);

  const result: SabremetricMatchRow[] = [];
  for (const raw of (sabRows ?? []) as PlayerMatchSabremetrics[]) {
    const pms = pmsLookup.get(raw.player_match_stats_id);
    if (!pms) continue;
    const sid = matchSeason.get(pms.match_id);
    if (sid == null) continue;
    if (seasonId != null && sid !== seasonId) continue;
    const player = playersById.get(pms.player_id);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { player_match_stats_id: _, ...sab } = raw;
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

/** Sums every field of `b` into `a` (returning a new object) via `Object.keys()` rather than
 *  per-field enumeration — the shared accumulation step behind every sabremetric total in this
 *  codebase, career/season aggregation here and per-player aggregation in
 *  `SabremetricsLeaderboardView`'s `aggregateRows()` alike. */
export function sumSabFields(a: SabFields, b: SabFields): SabFields {
  const result = { ...a };
  for (const key of Object.keys(b) as (keyof SabFields)[]) {
    result[key] = result[key] + b[key];
  }
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
