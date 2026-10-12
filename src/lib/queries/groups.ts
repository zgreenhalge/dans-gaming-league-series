import { getAdminClient } from '../supabase-admin';
import { getWeekLookup } from './_shared';
import { getSeasonSchedule, getSeasonWeekNav } from './schedule';
import { getSeasons } from './seasons';
import { getSeasonLeaderboard } from './leaderboard';
import { getGauntletBracketShape, getGauntletRounds } from './gauntlet';
import { roundHref, groupHref, weekHref } from '../crumbs';
import { extractSeasonNumber } from '../util';
import { deriveWeekView, type GauntletStageData, type WeekView } from '../stage-views';

// Data for the week, round and group pages. The shaping lives in `stage-views.ts` (pure); this file
// only fetches.

/** The `weeks` row behind a regular week's id: which season it belongs to and its number. `null` if
 *  it doesn't exist. Lets a page confirm the id sits under the season in its URL before fetching more. */
export async function getWeekRow(weekId: number): Promise<{ id: number; season_id: number; week_number: number } | null> {
  const w = (await getWeekLookup()).get(weekId);
  return w ? { id: weekId, season_id: w.season_id, week_number: w.week_number } : null;
}

/** A regular season's week page: the week, its scorecard and the navigation across the season's
 *  weeks. `null` if `weekId` isn't one of the season's weeks. Reads full rosters only for the weeks
 *  up to this one (standings are cumulative), plus a light listing of every week for the chip strip. */
export async function getWeekView(hubSeasonId: number, weekId: number): Promise<WeekView | null> {
  const row = await getWeekRow(weekId);
  if (!row || row.season_id !== hubSeasonId) return null;
  const [schedule, navWeeks] = await Promise.all([
    getSeasonSchedule(hubSeasonId, undefined, { throughWeek: row.week_number }),
    getSeasonWeekNav(hubSeasonId),
  ]);
  return deriveWeekView(hubSeasonId, schedule, navWeeks, weekId);
}

/** Everything the gauntlet round and group pages derive from: real rounds and the full bracket shape
 *  (pending pods included). */
export async function getGauntletStageData(gauntletSeasonId: number): Promise<GauntletStageData> {
  const [rounds, bracketShape] = await Promise.all([
    getGauntletRounds(gauntletSeasonId),
    getGauntletBracketShape(gauntletSeasonId),
  ]);
  return { rounds, bracketShape };
}

/** Seed number → the player currently holding it, from the regular season's standings — names an
 *  undecided "Seed 3" slot on a group that hasn't been scheduled yet. */
export async function getSeedNames(hubSeasonId: number): Promise<Map<number, string>> {
  const leaderboard = await getSeasonLeaderboard(hubSeasonId);
  return new Map(leaderboard.map((row, i) => [i + 1, row.player_name]));
}

/** The season a gauntlet pod belongs to, from its id. `null` if there's no such pod. */
export async function getPodSeasonId(podId: number): Promise<number | null> {
  const { data, error } = await getAdminClient().from('gauntlet_pods').select('season_id').eq('id', podId).maybeSingle();
  if (error) throw error;
  return data ? (data as { season_id: number }).season_id : null;
}

/** Site-relative paths of every week, round and group page (the sitemap's list). A gauntlet season's
 *  pages live under its paired regular season's id; an unpaired gauntlet is its own hub. A gauntlet's
 *  rounds are the bracket's and any round that already has games. */
export async function getStagePagePaths(): Promise<string[]> {
  const [seasons, weekLookup, podsRes] = await Promise.all([
    getSeasons(),
    getWeekLookup(),
    getAdminClient().from('gauntlet_pods').select('id, season_id, round_number'),
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

  const paths = new Set<string>();
  for (const [weekId, w] of weekLookup) {
    const hub = hubIdOf(w.season_id);
    if (hub == null) continue;
    paths.add(byId.get(w.season_id)!.is_gauntlet ? roundHref(hub, w.week_number) : weekHref(hub, weekId));
  }
  for (const pod of (podsRes.data ?? []) as { id: number; season_id: number; round_number: number }[]) {
    const hub = hubIdOf(pod.season_id);
    if (hub == null) continue;
    paths.add(roundHref(hub, pod.round_number));
    paths.add(groupHref(hub, pod.id));
  }
  return [...paths];
}
