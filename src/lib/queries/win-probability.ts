import { getPlayersById } from './player';
import { getRatedPlayers, type RatedPlayer } from './ehog';

/** Everything the win-probability calculator (`/tools/win-probability`) needs: every player with
 *  their current EHOG state (`getRatedPlayers()`), sorted by name. The odds are computed in the
 *  browser from `predictWinProbability()`. */
export async function getWinProbabilityData(): Promise<{ players: RatedPlayer[] }> {
  return { players: await getRatedPlayers(await getPlayersById()) };
}
