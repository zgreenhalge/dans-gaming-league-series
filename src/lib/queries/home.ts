import { gauntletHref, gauntletScheduleHref, roundHref, seasonHref, seasonScheduleHref, weekHref } from '../crumbs';
import type { GauntletRound, WeekWithMatches } from '../stage-types';
import type { Season } from '../types';
import {
  findCurrentGauntletRound,
  gauntletMatchToUpcomingGameRow,
  getGauntletRounds,
  getUpcomingGauntletGames,
} from './gauntlet';
import { resolveHomeSeasons, type HomeSeasons } from './seasons';
import { findCurrentWeek, getSeasonSchedule, getUpcomingGames, type UpcomingGameRow } from './schedule';

// The home page's Upcoming Games data. Which season is current comes from `resolveHomeSeasons()`
// (`queries/seasons.ts`); the signed-in player's My Stats panel is `getMyStats()`
// (`queries/myStats.ts`). Standings, Form and the Top duos / Hottest Rivalries lists come from
// `getAllLeaderboards()`, `getSeasonForm()` and `rankDuos()` / `rankRivals()`.

/** What the Upcoming Games and To Be Scheduled panels render, plus where their headings link. */
export interface HomeGames {
  /** Unplayed matches with a time, soonest first. */
  scheduled: UpcomingGameRow[];
  /** Unplayed matches still missing a time. */
  unscheduled: UpcomingGameRow[];
  /** The Upcoming Games heading's target: the current week's page (regular season) or current
   *  round's page (gauntlet), falling back to the season hub when there is none. */
  headingHref: string;
  /** The To Be Scheduled heading's target: the season hub's Schedule tab. */
  scheduleHref: string;
}

/** `HomeGames` for an active regular season. */
export function buildRegularHomeGames(season: Pick<Season, 'id' | 'start_date'>, schedule: WeekWithMatches[]): HomeGames {
  const { scheduled, unscheduled } = getUpcomingGames(schedule, season.start_date);
  const week = findCurrentWeek(schedule, season.start_date);
  return {
    scheduled,
    unscheduled,
    headingHref: week ? weekHref(season.id, week.id) : seasonHref(season.id),
    scheduleHref: seasonScheduleHref(season.id),
  };
}

/** `HomeGames` for an active gauntlet, whose pages hang off its paired regular season
 *  (`hubSeasonId`). A gauntlet has no weekly structure, so every unplayed bracket match counts. */
export function buildGauntletHomeGames(hubSeasonId: number, rounds: GauntletRound[]): HomeGames {
  const { scheduled, unscheduled } = getUpcomingGauntletGames(rounds);
  const round = findCurrentGauntletRound(rounds);
  return {
    scheduled: scheduled.map(gauntletMatchToUpcomingGameRow),
    unscheduled: unscheduled.map(gauntletMatchToUpcomingGameRow),
    headingHref: round ? roundHref(hubSeasonId, round.round_number) : gauntletHref(hubSeasonId),
    scheduleHref: gauntletScheduleHref(hubSeasonId),
  };
}

/** The home page's games for already-resolved seasons: the active regular season's, else the active
 *  gauntlet's; `null` when neither is active. */
export async function getHomeGamesFor(home: HomeSeasons): Promise<HomeGames | null> {
  if (home.regular) return buildRegularHomeGames(home.regular, await getSeasonSchedule(home.regular.id));
  if (!home.gauntlet) return null;
  return buildGauntletHomeGames(home.gauntlet.hubId, await getGauntletRounds(home.gauntlet.season.id));
}

/** `getHomeGamesFor()` for a raw season list, resolved with `resolveHomeSeasons()`. */
export async function getHomeGames(seasons: Season[]): Promise<HomeGames | null> {
  return getHomeGamesFor(resolveHomeSeasons(seasons));
}
