import { getAdminClient } from '../supabase-admin';
import { getWeekLookup } from './_shared';
import { getSeasonSchedule } from './schedule';
import { getSeasons } from './seasons';
import { getGauntletBracketShape, getGauntletRounds } from './gauntlet';
import { roundHref, groupHref, weekHref } from '../crumbs';
import { extractSeasonNumber } from '../util';
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

/** Site-relative paths of every week, round and group page (the sitemap's list). A gauntlet season's
 *  pages live under its paired regular season's id; an unpaired gauntlet is its own hub. */
export async function getStagePagePaths(): Promise<string[]> {
  const [seasons, weekLookup, podsRes] = await Promise.all([
    getSeasons(),
    getWeekLookup(),
    getAdminClient().from('gauntlet_pods').select('id, season_id'),
  ]);
  if (podsRes.error) throw podsRes.error;

  const byId = new Map(seasons.map((s) => [s.id, s]));
  const hubIdOf = (seasonId: number): number | null => {
    const season = byId.get(seasonId);
    if (!season) return null;
    if (!season.is_gauntlet) return season.id;
    const n = extractSeasonNumber(season.name);
    const paired = n == null ? undefined : seasons.find((s) => !s.is_gauntlet && extractSeasonNumber(s.name) === n);
    return (paired ?? season).id;
  };

  const paths: string[] = [];
  for (const [weekId, w] of weekLookup) {
    const hub = hubIdOf(w.season_id);
    if (hub == null) continue;
    paths.push(byId.get(w.season_id)!.is_gauntlet ? roundHref(hub, weekId) : weekHref(hub, weekId));
  }
  for (const pod of (podsRes.data ?? []) as { id: number; season_id: number }[]) {
    const hub = hubIdOf(pod.season_id);
    if (hub != null) paths.push(groupHref(hub, pod.id));
  }
  return paths;
}
