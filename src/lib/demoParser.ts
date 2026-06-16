import { parseEvent, parsePlayerInfo, parseTicks } from '@laihoe/demoparser2';

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
  warnings: string[];
}

function normName(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function resolveRoster(
  demoPlayers: { steamId: string; name: string }[],
  roster: RosterEntry[],
  warnings: string[],
): Map<string, { player_id: number; faction: 'SHIRTS' | 'SKINS' }> {
  const resolved = new Map<string, { player_id: number; faction: 'SHIRTS' | 'SKINS' }>();
  const usedIds = new Set<number>();
  let remaining = [...demoPlayers];

  // Pass 1: exact Steam ID
  for (const d of [...remaining]) {
    const slot = roster.find(
      (r) => r.steam_id && String(r.steam_id) === d.steamId && !usedIds.has(r.player_id),
    );
    if (slot) {
      resolved.set(d.steamId, { player_id: slot.player_id, faction: slot.faction });
      usedIds.add(slot.player_id);
      remaining = remaining.filter((r) => r.steamId !== d.steamId);
    }
  }

  // Pass 2: name / steam_nickname
  for (const d of [...remaining]) {
    const target = normName(d.name);
    const slot = roster.find(
      (r) =>
        !usedIds.has(r.player_id) &&
        (target === normName(r.name) || (r.steam_nickname && target === normName(r.steam_nickname))),
    );
    if (slot) {
      resolved.set(d.steamId, { player_id: slot.player_id, faction: slot.faction });
      usedIds.add(slot.player_id);
      remaining = remaining.filter((r) => r.steamId !== d.steamId);
    }
  }

  // Pass 3: elimination
  const open = roster.filter((r) => !usedIds.has(r.player_id));
  if (remaining.length === 1 && open.length === 1) {
    const d = remaining[0];
    warnings.push(
      `Resolved "${d.name}" (${d.steamId}) to roster player "${open[0].name}" by elimination — verify this is correct.`,
    );
    resolved.set(d.steamId, { player_id: open[0].player_id, faction: open[0].faction });
    remaining = [];
  }

  if (remaining.length > 0) {
    throw new Error(
      `Could not match ${remaining.length} demo player(s) to roster: ` +
        remaining.map((d) => `"${d.name}" (${d.steamId})`).join(', ') +
        '. Check that players have their Steam ID saved.',
    );
  }

  return resolved;
}

export function parseDemoFile(
  demoBuffer: Buffer,
  roster: RosterEntry[],
  skinsSide: 'CT' | 'T' | null,
  targetWinRounds: number,
): ParsedDemoResult {
  const warnings: string[] = [];

  // --- Player info (names + Steam IDs) ---
  const playerInfoRaw: { steamid: string | bigint; name: string }[] = parsePlayerInfo(demoBuffer);
  const demoPlayers = playerInfoRaw
    .filter((p) => p.steamid && String(p.steamid) !== '0')
    .map((p) => ({ steamId: String(p.steamid), name: p.name ?? '' }));

  const steamToPlayer = resolveRoster(demoPlayers, roster, warnings);

  // --- Round outcomes (needed for final tick + halftime logic) ---
  const roundEndEvents: {
    tick: number;
    round: number;
    winner: string | null;
    is_warmup_period: boolean | number;
  }[] = parseEvent(demoBuffer, 'round_end', [], ['winner', 'is_warmup_period']);

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

  // --- Round outcomes ---
  let shirtsRoundsWon = 0;
  let skinsRoundsWon = 0;

  if (skinsSide !== null) {
    // SHIRTS start on the opposite side from SKINS
    const shirtsStartSide = skinsSide === 'CT' ? 'T' : 'CT';
    const halftimeAfter = targetWinRounds - 1; // rounds 1..halftimeAfter are first half

    for (const e of liveRounds) {
      const shirtsWinSide = e.round <= halftimeAfter ? shirtsStartSide : (shirtsStartSide === 'T' ? 'CT' : 'T');
      if (e.winner === shirtsWinSide) shirtsRoundsWon++;
      else skinsRoundsWon++;
    }
  } else {
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
      skinsSide !== null &&
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
    shirts_score: skinsSide !== null ? shirtsRoundsWon : null,
    skins_score: skinsSide !== null ? skinsRoundsWon : null,
    warnings,
  };
}
