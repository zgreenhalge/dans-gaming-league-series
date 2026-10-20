import { gauntletHref, gauntletScheduleHref, roundHref, seasonHref, seasonScheduleHref, weekHref } from '../crumbs';
import type { H2HData } from '../h2h';
import type { GauntletRound, WeekWithMatches } from '../stage-types';
import type { LeaderboardRowWithId, Season } from '../types';
import { canonicalSort, extractSeasonNumber, findPairedSeason, mergeLeaderboardRows } from '../util';
import {
  findCurrentGauntletRound,
  gauntletMatchToUpcomingGameRow,
  getGauntletRounds,
  getGauntletStats,
  getUpcomingGauntletGames,
} from './gauntlet';
import { bestFriendOf, worstNightmareOf, type PersonalMatchup } from './h2h';
import { getCareerLeaderboard } from './leaderboard';
import { getPlayer, lastPlayed, nextUpcoming, opponentNames, type PlayerHistoryRow } from './player';
import { findCurrentWeek, getSeasonSchedule, getUpcomingGames, type UpcomingGameRow } from './schedule';

// The home page's data: the Upcoming Games panels (`getHomeGames()`) and the signed-in player's My
// Stats panel (`getMyStats()`). Standings, Form and the Top duos / Hottest Rivalries lists come
// from `getAllLeaderboards()`, `getSeasonForm()` and `rankDuos()` / `rankRivals()`.

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

/** The home page's games: the first active regular season's, else the first active gauntlet's;
 *  `null` when neither is active. */
export async function getHomeGames(seasons: Season[]): Promise<HomeGames | null> {
  const regular = seasons.find((s) => !s.is_gauntlet && s.status === 'ACTIVE');
  if (regular) return buildRegularHomeGames(regular, await getSeasonSchedule(regular.id));

  const gauntlet = seasons.find((s) => s.is_gauntlet && s.status === 'ACTIVE');
  if (!gauntlet) return null;
  const hub = findPairedSeason(gauntlet.name, seasons.filter((s) => !s.is_gauntlet));
  return buildGauntletHomeGames(hub?.id ?? gauntlet.id, await getGauntletRounds(gauntlet.id));
}

// The home page's "My Stats" panel: one signed-in player's career standing, upcoming match, recent
// results and their best friend / worst nightmare. Career-scoped throughout — rank, W-L and ADR
// come from the regular and gauntlet career leaderboards merged (the Statistics page's default
// view), matches from the player's full history, and the matchups from the career H2H.

/** How many results the panel's Match history lists. */
const MY_STATS_RECENT_LIMIT = 5;

/** One played match in the panel's Match history, from the player's side. `score` is the stored
 *  `final_score` (shirts–skins), shown as-is like every other match card. */
export interface MyStatsMatch {
  matchId: number;
  won: boolean;
  score: string;
  opponents: string;
  map: string | null;
}

/** The player's next unplayed match. */
export interface MyStatsNextMatch {
  matchId: number;
  opponents: string;
  map: string | null;
  scheduledAt: string | null;
}

/** The other player in a best-friend / worst-nightmare row, with the player's record against or
 *  alongside them. */
export interface MyStatsPlayer {
  id: number;
  name: string;
  wins: number;
  losses: number;
}

export interface MyStats {
  playerId: number;
  playerName: string;
  /** 1-based place on the career leaderboard (`canonicalSort()` order); `null` before the player's
   *  first played match. */
  rank: number | null;
  record: { wins: number; losses: number };
  adr: number;
  next: MyStatsNextMatch | null;
  /** Newest first, at most `MY_STATS_RECENT_LIMIT`. */
  recent: MyStatsMatch[];
  bestFriend: MyStatsPlayer | null;
  worstNightmare: MyStatsPlayer | null;
}

/**
 * Assembles a player's `MyStats` from already-fetched inputs — the pure core of `getMyStats()`.
 * `history` is `getPlayer()`'s newest-first `PlayerHistoryRow[]`; `leaderboard` the career
 * leaderboard; `h2h` the career H2H data.
 */
export function buildMyStats(input: {
  playerId: number;
  playerName: string;
  leaderboard: LeaderboardRowWithId[];
  history: PlayerHistoryRow[];
  h2h: H2HData;
}): MyStats {
  const { playerId, playerName, leaderboard, history, h2h } = input;

  const ranked = [...leaderboard].sort(canonicalSort);
  const index = ranked.findIndex((r) => r.player_id === playerId);
  const row = index >= 0 ? ranked[index] : null;

  const nameOf = new Map(h2h.players.map((p) => [p.id, p.name]));
  const toPlayer = (m: PersonalMatchup | null): MyStatsPlayer | null =>
    m ? { id: m.otherId, name: nameOf.get(m.otherId) ?? `#${m.otherId}`, wins: m.wins, losses: m.losses } : null;

  const next = nextUpcoming(history);

  return {
    playerId,
    playerName,
    rank: index >= 0 ? index + 1 : null,
    record: { wins: row?.matches_won ?? 0, losses: row?.matches_lost ?? 0 },
    adr: row?.overall_adr ?? 0,
    next: next
      ? { matchId: next.match_id, opponents: opponentNames(next), map: next.map, scheduledAt: next.scheduled_at }
      : null,
    recent: lastPlayed(history, MY_STATS_RECENT_LIMIT).map((r) => ({
      matchId: r.match_id,
      won: r.is_win,
      score: r.final_score ?? '',
      opponents: opponentNames(r),
      map: r.map,
    })),
    bestFriend: toPlayer(bestFriendOf(h2h.duos, playerId)),
    worstNightmare: toPlayer(worstNightmareOf(h2h.rivals, playerId)),
  };
}

/** The home page's My Stats data for `playerId`, or `null` when that player doesn't exist. `h2h` is
 *  the career H2H data the page already holds for its Top duos / Hottest Rivalries panels. */
export async function getMyStats(playerId: number, h2h: H2HData): Promise<MyStats | null> {
  const [regular, gauntlet, detail] = await Promise.all([getCareerLeaderboard(), getGauntletStats(), getPlayer(playerId)]);
  if (!detail) return null;
  return buildMyStats({
    playerId,
    playerName: detail.player.name,
    leaderboard: mergeLeaderboardRows(regular, gauntlet.career),
    history: detail.history,
    h2h,
  });
}

/** The season behind the home page's standings and what to say about it. */
export interface HomeStandingsSeason {
  season: Season;
  /** The season is running (`ACTIVE`); otherwise it is the latest finished one. */
  live: boolean;
  /** The season's paired gauntlet when it is running, so the panel can point at it. */
  gauntlet: Season | null;
}

/**
 * Which regular season the home standings show: the first active one, else the most recently
 * finished one (highest season number), else `null` — a league whose only seasons are upcoming has
 * no standings to show.
 */
export function pickStandingsSeason(seasons: Season[]): HomeStandingsSeason | null {
  const regular = seasons.filter((s) => !s.is_gauntlet);
  const active = regular.find((s) => s.status === 'ACTIVE');
  const season =
    active ??
    regular
      .filter((s) => s.status === 'ARCHIVED')
      .sort((a, b) => (extractSeasonNumber(b.name) ?? b.id) - (extractSeasonNumber(a.name) ?? a.id))[0];
  if (!season) return null;
  const gauntlet = findPairedSeason(season.name, seasons.filter((s) => s.is_gauntlet));
  return { season, live: season.status === 'ACTIVE', gauntlet: gauntlet?.status === 'ACTIVE' ? gauntlet : null };
}
