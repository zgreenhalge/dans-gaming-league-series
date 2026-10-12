import { getAdminClient } from '../supabase-admin';
import { getWeekLookup } from './_shared';
import { getSeasonSchedule } from './schedule';
import { getGauntletBracketShape, getGauntletRounds } from './gauntlet';
import { deriveWeekView, type GauntletStageData, type WeekView } from '../stage-views';

// Data for the week, round and group pages. The shaping lives in `stage-views.ts` (pure); this file
// only fetches.

/** A regular season's week page: the week, its scorecard and the navigation across the season's weeks.
 *  `null` if `weekId` isn't one of the season's weeks. Reads the season's full schedule — the same
 *  read the season hub makes — because the scorecard's standings movement needs every earlier week. */
export async function getWeekView(hubSeasonId: number, weekId: number): Promise<WeekView | null> {
  return deriveWeekView(hubSeasonId, await getSeasonSchedule(hubSeasonId), weekId);
}

/** Everything the gauntlet round and group pages derive from: real rounds, the full bracket shape
 *  (pending pods included) and each round's `weeks.id`. */
export async function getGauntletStageData(gauntletSeasonId: number): Promise<GauntletStageData> {
  const [rounds, bracketShape, weekLookup] = await Promise.all([
    getGauntletRounds(gauntletSeasonId),
    getGauntletBracketShape(gauntletSeasonId),
    getWeekLookup([gauntletSeasonId]),
  ]);
  const weekIdByRound = new Map<number, number>();
  for (const [id, w] of weekLookup) weekIdByRound.set(w.week_number, id);
  return { rounds, bracketShape, weekIdByRound };
}

/** The `weeks` row behind a week/round id: which season it belongs to and its number. `null` if it
 *  doesn't exist. Lets a page confirm the id sits under the season in its URL before fetching more. */
export async function getWeekRow(weekId: number): Promise<{ id: number; season_id: number; week_number: number } | null> {
  const w = (await getWeekLookup()).get(weekId);
  return w ? { id: weekId, season_id: w.season_id, week_number: w.week_number } : null;
}

/** The season a gauntlet pod belongs to, from its id. `null` if there's no such pod. */
export async function getPodSeasonId(podId: number): Promise<number | null> {
  const { data, error } = await getAdminClient().from('gauntlet_pods').select('season_id').eq('id', podId).maybeSingle();
  if (error) throw error;
  return data ? (data as { season_id: number }).season_id : null;
}
