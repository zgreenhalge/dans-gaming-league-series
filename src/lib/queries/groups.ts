import { cache } from 'react';
import { getAdminClient } from '../supabase-admin';
import { getWeekLookup } from './_shared';
import { getSeasonSchedule, getSeasonWeekNav } from './schedule';
import { getSeason, getSeasons, getSeasonScope, hubIdsBySeason, type SeasonScope } from './seasons';
import { getSeasonLeaderboard } from './leaderboard';
import { getGauntletBracketShape, getGauntletRounds } from './gauntlet';
import { roundHref, groupHref, weekHref } from '../crumbs';
import {
  deriveGroupPageView,
  deriveRoundView,
  deriveWeekView,
  type GauntletStageData,
  type GroupPageView,
  type RoundView,
  type WeekView,
} from '../stage-views';
import type { Season } from '../types';

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
export const getSeedNames = cache(async (hubSeasonId: number): Promise<Map<number, string>> => {
  const leaderboard = await getSeasonLeaderboard(hubSeasonId);
  return new Map(leaderboard.map((row, i) => [i + 1, row.player_name]));
});

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
  const hubs = hubIdsBySeason(seasons);

  const paths = new Set<string>();
  for (const [weekId, w] of weekLookup) {
    const hub = hubs.get(w.season_id);
    if (hub == null) continue;
    paths.add(byId.get(w.season_id)?.is_gauntlet ? roundHref(hub, w.week_number) : weekHref(hub, weekId));
  }
  for (const pod of (podsRes.data ?? []) as { id: number; season_id: number; round_number: number }[]) {
    const hub = hubs.get(pod.season_id);
    if (hub == null) continue;
    paths.add(roundHref(hub, pod.round_number));
    paths.add(groupHref(hub, pod.id));
  }
  return [...paths];
}

// ─── Page resolvers ──────────────────────────────────────────────────────────────────────────────
// Each turns the id(s) in a stage page's URL into everything the page and its Open Graph image render,
// or `null` when nothing is there. They never redirect or 404 themselves: a page checks `scope.hub`
// against the season id in its URL and redirects to the canonical one; an Open Graph image just
// renders what it's given.

/** A week id → its owning season, scope and (for a regular week) view. A gauntlet round's `weeks` row
 *  resolves too, with no view, so the page can send it to the round page. */
export async function resolveWeekPage(
  weekId: number,
): Promise<{ week: { id: number; week_number: number }; owner: Season; scope: SeasonScope; view: WeekView | null } | null> {
  const row = await getWeekRow(weekId);
  const owner = row ? await getSeason(row.season_id) : null;
  if (!row || !owner) return null;
  const [scope, view] = await Promise.all([
    getSeasonScope(owner),
    owner.is_gauntlet ? Promise.resolve(null) : getWeekView(owner.id, weekId),
  ]);
  return { week: row, owner, scope, view };
}

/** A season id and round number → the gauntlet round's view (`null` if the season has no gauntlet). */
export async function resolveRoundPage(
  seasonId: number,
  roundNumber: number,
): Promise<{ scope: SeasonScope; data: GauntletStageData; view: RoundView } | null> {
  const season = await getSeason(seasonId);
  if (!season) return null;
  const scope = await getSeasonScope(season);
  if (!scope.gauntlet) return null;
  const data = await getGauntletStageData(scope.gauntlet.id);
  const view = deriveRoundView(scope.hub.id, data, roundNumber);
  return view ? { scope, data, view } : null;
}

/** A pod id → the gauntlet group's page view. */
export async function resolveGroupPage(
  podId: number,
): Promise<{ scope: SeasonScope; data: GauntletStageData; view: GroupPageView } | null> {
  const seasonId = await getPodSeasonId(podId);
  const owner = seasonId === null ? null : await getSeason(seasonId);
  if (!owner) return null;
  const scope = await getSeasonScope(owner);
  const data = await getGauntletStageData(owner.id);
  const view = deriveGroupPageView(scope.hub.id, data, podId);
  return view ? { scope, data, view } : null;
}
