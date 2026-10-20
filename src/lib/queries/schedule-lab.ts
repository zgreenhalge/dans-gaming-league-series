import type { FormatPlayer, FormatRecord } from '../season-format';
import { seasonTitle } from '../util';
import { getPlayersById } from './player';
import { getSeasons, getSeasonParticipants } from './seasons';
import { getRatedPlayers } from './ehog';
import { getRawSeasonLeaderboardRows } from './leaderboard';

export interface ScheduleLabPlayer extends FormatPlayer {
  name: string;
}

/** A regular season's participants, offered as a one-click roster in the Schedule Lab, and its
 *  regular-season records per player id (`player_season_leaderboard`), which a win-rate division
 *  draft can rank by. `records` is empty for a season with nothing played yet. */
export interface ScheduleLabRoster {
  seasonId: number;
  label: string;
  playerIds: number[];
  records: Record<number, FormatRecord>;
}

export interface ScheduleLabData {
  /** Every player with their current EHOG state (`getRatedPlayers()`), sorted by name. */
  players: ScheduleLabPlayer[];
  /** Regular seasons' participants, newest season first. */
  rosters: ScheduleLabRoster[];
  /** Each player's record summed over every regular season — a career win-rate draft's ranking. */
  careerRecords: Record<number, FormatRecord>;
}

/** Everything the Schedule Lab (`/tools/schedule-lab`) needs to plan a season format in the browser:
 *  players with the rating state `buildFormatPlan()` balances on, and each regular season's
 *  participants (`getSeasonParticipants()` — rostered or played) as a starting roster, with the
 *  season's records (`player_season_leaderboard`) — and their career sum — for a win-rate division
 *  draft. */
export async function getScheduleLabData(): Promise<ScheduleLabData> {
  const [playersById, seasons, leaderboardRows] = await Promise.all([getPlayersById(), getSeasons(), getRawSeasonLeaderboardRows()]);
  const regular = seasons.filter((s) => !s.is_gauntlet).sort((a, b) => b.id - a.id);
  const [players, participants] = await Promise.all([
    getRatedPlayers(playersById),
    Promise.all(regular.map((s) => getSeasonParticipants(s.id, playersById))),
  ]);

  const recordsBySeason = new Map<number, Record<number, FormatRecord>>();
  const careerRecords: Record<number, FormatRecord> = {};
  for (const row of leaderboardRows) {
    const seasonRecords = recordsBySeason.get(row.season_id) ?? {};
    seasonRecords[row.player_id] = { wins: row.matches_won, losses: row.matches_lost };
    recordsBySeason.set(row.season_id, seasonRecords);
    const career = (careerRecords[row.player_id] ??= { wins: 0, losses: 0 });
    career.wins += row.matches_won;
    career.losses += row.matches_lost;
  }

  const rosters = regular.map((s, i) => ({
    seasonId: s.id,
    label: seasonTitle(s.name),
    playerIds: participants[i].map((p) => p.player_id),
    records: recordsBySeason.get(s.id) ?? {},
  }));
  return { players, rosters, careerRecords };
}
