// Resolve the inputs `buildReplay()` needs for a match, from the DB.
//
// Shared by the in-app dispatch path and the `replay-extract` Action script (run via
// `tsx`), so the roster/side/target-rounds resolution lives in exactly one place.
// Mirrors the roster assembly in `POST /api/matches/[id]/demo/parse`.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RosterEntry } from '../demoParser';
import type { Side } from './types';

export interface ReplayInputs {
  map: string;
  skinsSide: Side | null;
  targetWinRounds: number;
  roster: RosterEntry[];
  /** True for gauntlet/knife-round seasons — see `BuildReplayInput.includeKnifeRound`. */
  isGauntlet: boolean;
}

export async function getReplayInputs(
  supabaseAdmin: SupabaseClient,
  matchId: number,
): Promise<ReplayInputs> {
  const [{ data: matchRow, error: matchErr }, { data: matchStats }] = await Promise.all([
    supabaseAdmin
      .from('matches')
      .select('id, shirts_pick, picked_map, skins_starting_side, weeks(seasons(target_win_rounds, is_gauntlet))')
      .eq('id', matchId)
      .maybeSingle(),
    supabaseAdmin
      .from('player_match_stats')
      .select('player_id, faction')
      .eq('match_id', matchId),
  ]);

  if (matchErr) throw new Error(`Failed to read match ${matchId}: ${matchErr.message}`);
  if (!matchRow) throw new Error(`Match ${matchId} not found`);

  const match = matchRow as {
    shirts_pick: string | null;
    picked_map: string | null;
    skins_starting_side: Side | null;
    weeks: unknown;
  };

  const weeksArr = Array.isArray(match.weeks) ? match.weeks : [match.weeks];
  const firstWeek = weeksArr[0] as { seasons: unknown } | undefined;
  const seasonsArr = Array.isArray(firstWeek?.seasons) ? firstWeek!.seasons : [firstWeek?.seasons];
  const firstSeason = seasonsArr[0] as { target_win_rounds?: number; is_gauntlet?: boolean } | undefined;
  const targetWinRounds = firstSeason?.target_win_rounds ?? 13;
  const isGauntlet = firstSeason?.is_gauntlet ?? false;

  const allStats = (matchStats ?? []) as { player_id: number; faction: string }[];
  const playerIds = allStats.map((s) => s.player_id);
  const { data: playerDetails } = await supabaseAdmin
    .from('players')
    .select('id, name, steam_id, steam_nickname')
    .in('id', playerIds);

  const playerMap = new Map(
    ((playerDetails ?? []) as {
      id: number;
      name: string;
      steam_id: string | null;
      steam_nickname: string | null;
    }[]).map((p) => [p.id, p]),
  );

  const roster: RosterEntry[] = allStats.map((s) => {
    const p = playerMap.get(s.player_id);
    return {
      player_id: s.player_id,
      faction: s.faction as 'SHIRTS' | 'SKINS',
      steam_id: p?.steam_id ?? null,
      name: p?.name ?? `#${s.player_id}`,
      steam_nickname: p?.steam_nickname ?? null,
    };
  });

  return {
    map: match.shirts_pick ?? match.picked_map ?? '',
    skinsSide: match.skins_starting_side,
    targetWinRounds,
    roster,
    isGauntlet,
  };
}
