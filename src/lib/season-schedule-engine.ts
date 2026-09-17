/**
 * Maps a season's roster (real `player_id`s) onto `season-schedule.ts`'s abstract seed numbers and
 * back — the "caller maps seeds to player_ids" boundary `buildSeasonSchedule()` calls out in its
 * own docs, mirroring how `gauntlet-engine.ts`'s `seedBracket()` maps `buildGauntletBracket()`'s
 * seeds to real players. Unlike gauntlet (seeded by competitive standing), a regular season has no
 * standings yet when its schedule is first generated — seed order is simply roster order (the
 * caller's `player_ids` array, e.g. `getSeasonRoster()`'s name-sorted order), which has no bearing
 * on the schedule's fairness properties: every pair's teammate/opponent coverage is symmetric in
 * seed identity, so which player lands on which seed number doesn't change what the schedule
 * guarantees.
 */

import { buildSeasonSchedule, type DoubleheaderPolicy } from './season-schedule';

export interface PlayerMatchPlan {
  shirts: [number, number];
  skins: [number, number];
}

export interface PlayerWeekPlan {
  week: number;
  matches: PlayerMatchPlan[];
  byePlayerIds: number[];
}

export function buildRosterSchedule(
  playerIds: number[],
  options?: { doubleheaderPolicy?: DoubleheaderPolicy; initialBalance?: Map<number, number> },
): PlayerWeekPlan[] {
  if (new Set(playerIds).size !== playerIds.length) {
    throw new Error('buildRosterSchedule: playerIds must not contain duplicates');
  }

  const seedToPlayer = new Map<number, number>(playerIds.map((id, i) => [i + 1, id]));
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
    playerIds.forEach((id, i) => {
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
