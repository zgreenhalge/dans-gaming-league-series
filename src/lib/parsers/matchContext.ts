import { parseHeader } from '@laihoe/demoparser2';
import { buildRoundSides, sideForFaction, type RoundEndRow, type RoundSideInfo } from './roundSides';

export interface PlayerDeathRow {
  tick: number;
  total_rounds_played: number;
  attacker_steamid: string | null;
  user_steamid: string | null;
  headshot: boolean;
  assister_steamid: string | null;
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
    if (parsed > 0 && parsed < 1000) {
      tickRate = parsed;
    } else {
      warnings.push('Tick rate absent or implausible in demo header — defaulting to 64.');
    }
  } catch {
    warnings.push('Could not parse demo header for tick rate — defaulting to 64.');
  }

  const rounds = buildRoundSides(roundEndEvents, skinsStartingSide, targetWinRounds);
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

  const roundDeaths = new Map<string, Set<number>>();
  for (const d of deathEvents) {
    const roundNumber = d.total_rounds_played + 1;
    if (!liveRounds.has(roundNumber)) continue;
    const victim = d.user_steamid;
    if (!victim || !steamToPlayer.has(victim)) continue;
    if (!roundDeaths.has(victim)) roundDeaths.set(victim, new Set());
    roundDeaths.get(victim)!.add(roundNumber);
  }

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
