import { parseEvent, parseTicks } from '@laihoe/demoparser2';
import { readDemoPlayers, resolveRoster } from './parsers/rosterResolver';
import { buildRoundSides } from './parsers/roundSides';
import {
  inferSkinsStartingSide,
  resolveEffectiveSide,
  sideDisagreementWarning,
} from './parsers/sideInference';
import type { RoundCondition, RoundHistoryEntry } from './types';

/** Map a CS2 round_end `reason` string to the win-condition icon bucket. */
function reasonToCondition(reason: string | null): RoundCondition {
  switch (reason) {
    case 'bomb_exploded':
      return 'bomb';
    case 'bomb_defused':
      return 'defuse';
    case 'time_ran_out':
    case 't_saved':
      return 'time';
    // 't_killed' (CT elim) and 'ct_killed' (T elim) both read as eliminations.
    default:
      return 'elim';
  }
}

const TRACKING = 'CCSPlayerController.CCSPlayerController_ActionTrackingServices';

export interface RosterEntry {
  player_id: number;
  faction: 'SHIRTS' | 'SKINS';
  steam_id: string | null;
  name: string;
  steam_nickname: string | null;
}

export interface DemoPlayerStat {
  player_id: number;
  faction: 'SHIRTS' | 'SKINS';
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  rounds_played: number;
  rounds_won: number;
  adr: number;
  is_win: boolean;
}

export interface ParsedDemoResult {
  stats: DemoPlayerStat[];
  shirts_score: number | null;
  skins_score: number | null;
  round_history: RoundHistoryEntry[] | null;
  warnings: string[];
  /** Side inferred from the demo's round-1 `team_num` (null if unresolvable); for diagnostics. */
  inferred_side: 'CT' | 'T' | null;
}

export function parseDemoFile(
  demoBuffer: Buffer,
  roster: RosterEntry[],
  skinsSide: 'CT' | 'T' | null,
  targetWinRounds: number,
): ParsedDemoResult {
  const warnings: string[] = [];

  // --- Player info (names + Steam IDs) ---
  const demoPlayers = readDemoPlayers(demoBuffer);
  const steamToPlayer = resolveRoster(demoPlayers, roster, warnings);

  // --- Round outcomes (needed for final tick + halftime logic) ---
  const roundEndEvents: {
    tick: number;
    round: number;
    winner: string | null;
    reason: string | null;
    is_warmup_period: boolean | number;
  }[] = parseEvent(demoBuffer, 'round_end', [], ['winner', 'reason', 'is_warmup_period']);

  const liveRounds = roundEndEvents.filter(
    (e) => !e.is_warmup_period && e.winner !== null && e.round > 0,
  );
  const totalRounds = liveRounds.length;

  // --- K / D / A / Damage: read all from the engine's own accumulators ---
  // These match the end-of-match scoreboard exactly, with no event math required.
  const kills = new Map<string, number>();
  const deaths = new Map<string, number>();
  const assists = new Map<string, number>();
  const damage = new Map<string, number>();

  if (liveRounds.length > 0) {
    const finalTick = liveRounds[liveRounds.length - 1].tick;
    const statRows: { steamid: string | bigint; [key: string]: unknown }[] = parseTicks(
      demoBuffer,
      [
        `${TRACKING}.m_iKills`,
        `${TRACKING}.m_iDeaths`,
        `${TRACKING}.m_iAssists`,
        `${TRACKING}.m_iDamage`,
      ],
      [finalTick],
    );
    for (const row of statRows) {
      const sid = String(row.steamid ?? '');
      if (!sid || sid === '0') continue;
      kills.set(sid,   (row[`${TRACKING}.m_iKills`]   as number) ?? 0);
      deaths.set(sid,  (row[`${TRACKING}.m_iDeaths`]  as number) ?? 0);
      assists.set(sid, (row[`${TRACKING}.m_iAssists`] as number) ?? 0);
      damage.set(sid,  (row[`${TRACKING}.m_iDamage`]  as number) ?? 0);
    }
  }

  // --- Starting side: stored wins; fall back to inferring it from the demo (the
  // round-1 anchor gauntlet/knife matches have no stored value for). ---
  const inferredSide =
    liveRounds.length > 0
      ? inferSkinsStartingSide(demoBuffer, liveRounds[0].tick, steamToPlayer)
      : null;
  const { side: effectiveSide, disagreed } = resolveEffectiveSide(skinsSide, inferredSide);
  if (disagreed && skinsSide !== null && inferredSide !== null) {
    warnings.push(sideDisagreementWarning(skinsSide, inferredSide));
  }

  // --- Round outcomes (via shared side logic) ---
  let shirtsRoundsWon = 0;
  let skinsRoundsWon = 0;

  const roundSides = buildRoundSides(
    liveRounds.map((e) => ({
      tick: e.tick,
      total_rounds_played: e.round,
      winner: e.winner,
      is_warmup_period: false,
    })),
    effectiveSide,
    targetWinRounds,
  );

  // buildRoundSides filters identically to `liveRounds` above and preserves
  // order, so the two arrays line up index-for-index.
  let roundHistory: RoundHistoryEntry[] | null = null;

  if (roundSides.length > 0) {
    roundHistory = [];
    for (let i = 0; i < roundSides.length; i++) {
      const r = roundSides[i];
      const winner: 'SHIRTS' | 'SKINS' =
        r.winnerSide === r.shirtsSide ? 'SHIRTS' : 'SKINS';
      if (winner === 'SHIRTS') shirtsRoundsWon++;
      else skinsRoundsWon++;
      roundHistory.push({
        n: r.roundNumber,
        winner,
        side: r.winnerSide as 'CT' | 'T',
        condition: reasonToCondition(liveRounds[i]?.reason ?? null),
      });
    }
  } else if (effectiveSide === null) {
    warnings.push(
      'Starting side unknown — rounds won cannot be determined from the demo. Enter the score manually.',
    );
  }

  // --- Assemble per-player stats ---
  const stats: DemoPlayerStat[] = [];

  for (const [steamId, { player_id, faction }] of steamToPlayer) {
    const roundsWon = faction === 'SHIRTS' ? shirtsRoundsWon : skinsRoundsWon;
    const dmg = damage.get(steamId) ?? 0;
    const adr = totalRounds > 0 ? Math.round(dmg / totalRounds) : 0;
    const isWin =
      effectiveSide !== null &&
      (faction === 'SHIRTS' ? shirtsRoundsWon > skinsRoundsWon : skinsRoundsWon > shirtsRoundsWon);

    stats.push({
      player_id,
      faction,
      kills: kills.get(steamId) ?? 0,
      deaths: deaths.get(steamId) ?? 0,
      assists: assists.get(steamId) ?? 0,
      damage: dmg,
      rounds_played: totalRounds,
      rounds_won: roundsWon,
      adr,
      is_win: isWin,
    });
  }

  return {
    stats,
    shirts_score: effectiveSide !== null ? shirtsRoundsWon : null,
    skins_score: effectiveSide !== null ? skinsRoundsWon : null,
    round_history: roundHistory,
    warnings,
    inferred_side: inferredSide,
  };
}
