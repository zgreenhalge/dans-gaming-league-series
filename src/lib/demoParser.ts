import { parseTicks } from '@laihoe/demoparser2';
import { readDemoPlayers, resolveRoster } from './parsers/rosterResolver';
import { findMatchStartTick, getLiveRoundEndEvents } from './parsers/matchContext';
import { buildRoundSides, reasonToCondition } from './parsers/roundSides';
import {
  inferSkinsStartingSide,
  resolveEffectiveSide,
  sideDisagreementWarning,
} from './parsers/sideInference';
import { mergeSegmentResults } from './parsers/segmentMerge';
import { orchestrateSegments } from './parsers/segmentOrchestrator';
import type { RoundHistoryEntry } from './types';

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
  /** See `buildRoundSides()`'s doc — 1 for a standalone demo (every direct caller), or the
   *  match-wide starting round `parseDemoFileSegments()` supplies for a later segment of a
   *  restart-interrupted match. */
  startingRealRound = 1,
): ParsedDemoResult {
  const warnings: string[] = [];

  // --- Player info (names + Steam IDs) ---
  const demoPlayers = readDemoPlayers(demoBuffer);
  const steamToPlayer = resolveRoster(demoPlayers, roster, warnings);

  // --- Round outcomes (needed for final tick + halftime logic) ---
  const matchStartTick = findMatchStartTick(demoBuffer);
  const liveRounds = getLiveRoundEndEvents(demoBuffer, matchStartTick);
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
      ? inferSkinsStartingSide(
          demoBuffer, liveRounds[0].tick, steamToPlayer, targetWinRounds, startingRealRound,
        )
      : null;
  const { side: effectiveSide, disagreed } = resolveEffectiveSide(skinsSide, inferredSide);
  if (disagreed && skinsSide !== null && inferredSide !== null) {
    warnings.push(sideDisagreementWarning(skinsSide, inferredSide));
  }

  // --- Round outcomes (via shared side logic) ---
  let shirtsRoundsWon = 0;
  let skinsRoundsWon = 0;

  const roundSides = buildRoundSides(
    liveRounds,
    effectiveSide,
    targetWinRounds,
    matchStartTick,
    startingRealRound,
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

/**
 * Parses a match split across multiple demo recordings (e.g. by a server restart mid-match — see
 * docs/demo-ingestion.md) and combines them into one result. Thin glue over `orchestrateSegments()`
 * (segmentOrchestrator.ts) — that shared function does the actual probe/offset/agreement/merge
 * sequencing, identical to `parseDemoSabremetricsSegments()`'s (demoOrchestrator.ts) except for
 * which per-segment parser and merge function it's given.
 */
export function parseDemoFileSegments(
  demoBuffers: Buffer[],
  roster: RosterEntry[],
  skinsSide: 'CT' | 'T' | null,
  targetWinRounds: number,
): ParsedDemoResult {
  return orchestrateSegments(
    demoBuffers,
    (buf, startingRealRound) => parseDemoFile(buf, roster, skinsSide, targetWinRounds, startingRealRound),
    mergeSegmentResults,
    (segment) => segment.stats.map((p) => p.player_id),
  );
}
