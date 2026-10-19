import { DEFAULT_EHOG, MU_DEFAULT, SIGMA_DEFAULT } from '../ehog';
import type { FormatPlayer } from '../season-format';
import { seasonTitle } from '../util';
import { getPlayersById } from './player';
import { getSeasons, getSeasonParticipants } from './seasons';
import { getPlayerRatings } from './ehog';

export interface ScheduleLabPlayer extends FormatPlayer {
  name: string;
}

/** A regular season's participants, offered as a one-click roster in the Schedule Lab. */
export interface ScheduleLabRoster {
  seasonId: number;
  label: string;
  playerIds: number[];
}

export interface ScheduleLabData {
  /** Every player with their current EHOG state (`getPlayerRatings()`), sorted by name. */
  players: ScheduleLabPlayer[];
  /** Regular seasons' participants, newest season first. */
  rosters: ScheduleLabRoster[];
}

/** Everything the Schedule Lab (`/schedule-lab`) needs to plan a season format in the browser:
 *  players with the rating state `buildFormatPlan()` balances on, and each regular season's
 *  participants (`getSeasonParticipants()` — rostered or played) as a starting roster. */
export async function getScheduleLabData(): Promise<ScheduleLabData> {
  const [playersById, seasons] = await Promise.all([getPlayersById(), getSeasons()]);
  const regular = seasons.filter((s) => !s.is_gauntlet).sort((a, b) => b.id - a.id);
  const [ratings, participants] = await Promise.all([
    getPlayerRatings([...playersById.keys()]),
    Promise.all(regular.map((s) => getSeasonParticipants(s.id, playersById))),
  ]);

  // A seed_ehog outside the display scale's (10, 100) range has no mu (`fromEhog()`'s domain), and a
  // NaN rating would poison every win probability it touches — such a player plans as a new one.
  const players = ratings
    .map((r) => {
      const name = playersById.get(r.playerId)!.name;
      if (!Number.isFinite(r.mu) || !Number.isFinite(r.sigma)) {
        return { id: r.playerId, name, mu: MU_DEFAULT, sigma: SIGMA_DEFAULT, ehog: DEFAULT_EHOG };
      }
      return { id: r.playerId, name, mu: r.mu, sigma: r.sigma, ehog: r.ehogRating };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const rosters = regular.map((s, i) => ({
    seasonId: s.id,
    label: seasonTitle(s.name),
    playerIds: participants[i].map((p) => p.player_id),
  }));
  return { players, rosters };
}
