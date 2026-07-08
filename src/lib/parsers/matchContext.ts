import { parseEvent, parseHeader } from '@laihoe/demoparser2';
import { buildRoundSides, sideForFaction, type RoundEndRow, type RoundSideInfo } from './roundSides';

/**
 * Tick the live match starts at — the last `begin_new_match`. MatchZy fires it on every warmup
 * restart and on the knife→match transition, so the max tick is the real start. Any round_end
 * before it is warmup or an erroneously-recorded knife round; callers drop those. Returns 0 when
 * the demo has no `begin_new_match` (so nothing is filtered by tick).
 */
export function findMatchStartTick(demoBuffer: Buffer): number {
  let maxTick = 0;
  try {
    const events: { tick: number }[] = parseEvent(demoBuffer, 'begin_new_match');
    for (const e of events) {
      if (typeof e.tick === 'number' && e.tick > maxTick) maxTick = e.tick;
    }
  } catch {
    // event absent/unreadable — leave 0 so no rounds are filtered by tick
  }
  return maxTick;
}

export interface PlayerDeathRow {
  tick: number;
  total_rounds_played: number;
  attacker_steamid: string | null;
  user_steamid: string | null;
  headshot: boolean;
  assister_steamid: string | null;
}

export interface PlayerHurtRow {
  tick: number;
  total_rounds_played: number;
  attacker_steamid: string | null;
  user_steamid: string | null;
  weapon: string;
  dmg_health: number;
  hitgroup: string;
}

export interface MatchContext {
  rounds: RoundSideInfo[];
  liveRounds: Set<number>;
  roundEndTicks: Int32Array;
  tickRate: number;
  playerSides: Map<string, Map<number, 'CT' | 'T'>>;
  roundDeaths: Map<string, Set<number>>;
  factionOf: Map<string, 'SHIRTS' | 'SKINS'>;
  warnings: string[];
  hasSides: boolean;
}

/**
 * Groups death rounds per victim: round+1 offset, gated to live rounds, only for known players.
 * Shared by buildMatchContext and the test fixture (matchContextFixture.ts) so the two can't drift.
 */
export function buildRoundDeaths(
  deathEvents: PlayerDeathRow[],
  liveRounds: Set<number>,
  isKnownPlayer: (steamId: string) => boolean,
): Map<string, Set<number>> {
  const roundDeaths = new Map<string, Set<number>>();
  for (const d of deathEvents) {
    const roundNumber = d.total_rounds_played + 1;
    if (!liveRounds.has(roundNumber)) continue;
    const victim = d.user_steamid;
    if (!victim || !isKnownPlayer(victim)) continue;
    if (!roundDeaths.has(victim)) roundDeaths.set(victim, new Set());
    roundDeaths.get(victim)!.add(roundNumber);
  }
  return roundDeaths;
}

export function buildMatchContext(
  demoBuffer: Buffer,
  roundEndEvents: RoundEndRow[],
  deathEvents: PlayerDeathRow[],
  steamToPlayer: Map<string, { player_id: number; faction: 'SHIRTS' | 'SKINS' }>,
  skinsStartingSide: 'CT' | 'T' | null,
  targetWinRounds: number,
): MatchContext {
  const warnings: string[] = [];

  let tickRate = 64;
  try {
    const header = parseHeader(demoBuffer);
    const parsed = Number(header.tickrate ?? header.tick_rate);
    // CS2 demos frequently omit a usable tickrate in the header; 64 is the correct
    // default for this league, so fall back silently rather than warn.
    if (parsed > 0 && parsed < 1000) {
      tickRate = parsed;
    }
  } catch {
    // header unreadable — keep the 64 default
  }

  const matchStartTick = findMatchStartTick(demoBuffer);
  const rounds = buildRoundSides(roundEndEvents, skinsStartingSide, targetWinRounds, matchStartTick);
  const hasSides = rounds.length > 0;

  if (!hasSides && skinsStartingSide === null) {
    warnings.push(
      'Starting side unknown — CT/T splits will be skipped.',
    );
  }

  const liveRounds = new Set(rounds.map((r) => r.roundNumber));
  const roundEndTicks = Int32Array.from(rounds.map((r) => r.endTick));

  const roundByNumber = new Map<number, RoundSideInfo>();
  for (const r of rounds) roundByNumber.set(r.roundNumber, r);

  const factionOf = new Map<string, 'SHIRTS' | 'SKINS'>();
  for (const [steamId, { faction }] of steamToPlayer) {
    factionOf.set(steamId, faction);
  }

  const playerSides = new Map<string, Map<number, 'CT' | 'T'>>();
  if (hasSides) {
    for (const [steamId, faction] of factionOf) {
      const sideMap = new Map<number, 'CT' | 'T'>();
      for (const r of rounds) {
        sideMap.set(r.roundNumber, sideForFaction(r, faction));
      }
      playerSides.set(steamId, sideMap);
    }
  }

  const roundDeaths = buildRoundDeaths(deathEvents, liveRounds, (steamId) => steamToPlayer.has(steamId));

  return {
    rounds,
    liveRounds,
    roundEndTicks,
    tickRate,
    playerSides,
    roundDeaths,
    factionOf,
    warnings,
    hasSides,
  };
}
