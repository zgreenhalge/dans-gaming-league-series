/**
 * Maps a season's roster (real `player_id`s) onto `season-schedule.ts`'s abstract seed numbers and
 * back — the "caller maps seeds to player_ids" boundary `buildSeasonSchedule()` calls out in its
 * own docs, mirroring how `gauntlet-engine.ts`'s `seedBracket()` maps `buildGauntletBracket()`'s
 * seeds to real players. Unlike gauntlet (seeded by competitive standing), a regular season has no
 * standings yet when its schedule is first generated — seed order is simply roster order (the
 * caller's `player_ids` array, e.g. `getSeasonRoster()`'s name-sorted order). Teammate/opponent
 * coverage is symmetric in seed identity, so seed order doesn't change those guarantees. Match
 * counts are not: when roster size mod 4 = 2, the seeds one match short are fixed per roster size.
 * `shortCountHistory` (player_id → past regular seasons spent on the short count) steers who takes
 * them: players with the most past short seasons get the full-count seeds, and ties keep roster
 * order.
 */

import { buildSeasonSchedule, gamesPerSeed, type DoubleheaderPolicy } from './season-schedule';
import { shortCountPlayerIds } from './util';

export interface PlayerMatchPlan {
  shirts: [number, number];
  skins: [number, number];
}

export interface PlayerWeekPlan {
  week: number;
  matches: PlayerMatchPlan[];
  byePlayerIds: number[];
}

/**
 * The roster reordered so seed `i + 1` is element `i`: players with the most past short seasons take
 * the seeds that get the full match count, the rest take the short seeds. A stable sort keeps roster
 * order among equal histories.
 */
function orderRosterForShortCount(
  playerIds: number[],
  shortCountHistory: Map<number, number>,
  doubleheaderPolicy: DoubleheaderPolicy | undefined,
): number[] {
  // Only roster sizes with mod 4 = 2 end up with a short count; skip building a schedule otherwise.
  if (playerIds.length % 4 !== 2) return playerIds;

  const games = gamesPerSeed(buildSeasonSchedule(playerIds.length, { doubleheaderPolicy }), playerIds.length);
  if (shortCountPlayerIds(games).length === 0) return playerIds;

  // Seeds with the most games first (ties keep seed order), matched to players with the most past
  // short seasons first.
  const seedsByGames = [...games.keys()].sort((a, b) => games.get(b)! - games.get(a)!);
  const playersByNeed = [...playerIds].sort((a, b) => (shortCountHistory.get(b) ?? 0) - (shortCountHistory.get(a) ?? 0));
  const ordered: number[] = new Array(playerIds.length);
  seedsByGames.forEach((seed, i) => (ordered[seed - 1] = playersByNeed[i]));
  return ordered;
}

export function buildRosterSchedule(
  playerIds: number[],
  options?: {
    doubleheaderPolicy?: DoubleheaderPolicy;
    initialBalance?: Map<number, number>;
    shortCountHistory?: Map<number, number>;
  },
): PlayerWeekPlan[] {
  if (new Set(playerIds).size !== playerIds.length) {
    throw new Error('buildRosterSchedule: playerIds must not contain duplicates');
  }
  const seatedIds = options?.shortCountHistory
    ? orderRosterForShortCount(playerIds, options.shortCountHistory, options.doubleheaderPolicy)
    : playerIds;

  const seedToPlayer = new Map<number, number>(seatedIds.map((id, i) => [i + 1, id]));
  const player = (seed: number): number => {
    const id = seedToPlayer.get(seed);
    if (id == null) throw new Error(`buildRosterSchedule: seed ${seed} has no corresponding player_id`);
    return id;
  };

  // initialBalance arrives keyed by real player_id (the caller's real-balance query, keyed the same
  // way every other player-facing map in this codebase is); translate to the seed-keyed map
  // buildSeasonSchedule() operates in, mirroring seedToPlayer's own direction.
  const seedBalance = new Map<number, number>();
  if (options?.initialBalance) {
    seatedIds.forEach((id, i) => {
      const bal = options.initialBalance!.get(id);
      if (bal != null) seedBalance.set(i + 1, bal);
    });
  }

  const weeks = buildSeasonSchedule(playerIds.length, { doubleheaderPolicy: options?.doubleheaderPolicy, initialBalance: seedBalance });
  return weeks.map((w) => ({
    week: w.week,
    matches: w.matches.map((m) => ({
      shirts: [player(m.shirts[0]), player(m.shirts[1])] as [number, number],
      skins: [player(m.skins[0]), player(m.skins[1])] as [number, number],
    })),
    byePlayerIds: w.byeSeeds.map(player),
  }));
}
