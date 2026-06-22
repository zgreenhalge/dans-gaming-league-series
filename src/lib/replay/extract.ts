// Build a `replay.json` payload from a CS2 demo buffer.
//
// Runtime-agnostic: this exact module runs both in-app (the dispatch path) and in
// the `replay-extract` GitHub Action (via `tsx`), so there is no logic drift — see
// `docs/replay.md`. It reuses the same demo primitives as the stats path:
// `parseEvent`, `parseTicks`, `parseGrenades`, plus the roster/side helpers.

import { parseEvent, parseTicks, parseGrenades } from '@laihoe/demoparser2';
import { readDemoPlayers, resolveRoster } from '../parsers/rosterResolver';
import { buildMatchContext, type PlayerDeathRow } from '../parsers/matchContext';
import { sideForFaction, type RoundEndRow } from '../parsers/roundSides';
import type { RosterEntry } from '../demoParser';
import type { RoundCondition, Faction } from '../types';
import {
  REPLAY_SCHEMA_VERSION,
  type ReplayPayload,
  type ReplayRound,
  type ReplayFrame,
  type ReplayPlayerFrame,
  type ReplayEvent,
  type ReplayGrenade,
  type GrenadePoint,
  type Side,
} from './types';

/** Target playback cadence. Frames are downsampled from tickRate to this. */
const FRAME_RATE = 16;

/** Map a CS2 round_end `reason` to the win-condition icon bucket (mirrors demoParser). */
function reasonToCondition(reason: string | null): RoundCondition {
  switch (reason) {
    case 'bomb_exploded':
      return 'bomb';
    case 'bomb_defused':
      return 'defuse';
    case 'time_ran_out':
    case 't_saved':
      return 'time';
    default:
      return 'elim';
  }
}

/** Read the first present key from a parser row (field names vary across props). */
function pick<T>(row: Record<string, unknown>, keys: string[]): T | null {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null) return v as T;
  }
  return null;
}

function normGrenadeType(raw: string | null): string {
  const s = (raw ?? '').toLowerCase();
  if (s.includes('smoke')) return 'smoke';
  if (s.includes('flash')) return 'flashbang';
  if (s.includes('molotov')) return 'molotov';
  if (s.includes('inc')) return 'incendiary';
  if (s.includes('decoy')) return 'decoy';
  if (s.includes('he') || s.includes('frag')) return 'he';
  return s || 'unknown';
}

export interface BuildReplayInput {
  demoBuffer: Buffer;
  matchId: number;
  map: string;
  roster: RosterEntry[];
  skinsSide: Side | null;
  targetWinRounds: number;
}

export interface BuildReplayResult {
  payload: ReplayPayload;
  warnings: string[];
}

export function buildReplay(input: BuildReplayInput): BuildReplayResult {
  const { demoBuffer, matchId, map, roster, skinsSide, targetWinRounds } = input;
  const warnings: string[] = [];

  // --- Roster resolution (steamid → DGLS player + faction) ---
  const demoPlayers = readDemoPlayers(demoBuffer);
  const steamToPlayer = resolveRoster(demoPlayers, roster, warnings);
  const playerIdOf = (steamId: string | null | undefined): number | null => {
    if (!steamId) return null;
    return steamToPlayer.get(String(steamId))?.player_id ?? null;
  };

  // --- Round structure + sides (reuse the stats path's context) ---
  const roundEndRows = parseEvent(
    demoBuffer,
    'round_end',
    [],
    ['total_rounds_played', 'winner', 'reason', 'is_warmup_period'],
  ) as (RoundEndRow & { reason: string | null })[];

  const deathRows = parseEvent(
    demoBuffer,
    'player_death',
    ['X', 'Y'],
    ['total_rounds_played', 'is_warmup_period', 'headshot', 'weapon', 'assister_steamid'],
  ) as (PlayerDeathRow & Record<string, unknown>)[];

  const context = buildMatchContext(
    demoBuffer,
    roundEndRows,
    deathRows,
    steamToPlayer,
    skinsSide,
    targetWinRounds,
  );
  warnings.push(...context.warnings);

  const meta = {
    version: REPLAY_SCHEMA_VERSION,
    matchId,
    map,
    tickRate: context.tickRate,
    frameRate: FRAME_RATE,
    players: [...steamToPlayer.entries()].map(([steamId, p]) => {
      const r = roster.find((e) => e.player_id === p.player_id);
      return { id: p.player_id, name: r?.name ?? `#${p.player_id}`, faction: p.faction, steamId };
    }),
    rounds: [] as ReplayRound[],
  } satisfies ReplayPayload;

  if (context.rounds.length === 0) {
    warnings.push('No live rounds found — replay has no rounds.');
    return { payload: meta, warnings: [...new Set(warnings)] };
  }

  // reason lookup keyed by ended-round number (round_end uses total_rounds_played as-is)
  const reasonByRound = new Map<number, string | null>();
  for (const e of roundEndRows) {
    if (e.is_warmup_period || e.winner === null || e.total_rounds_played <= 0) continue;
    reasonByRound.set(e.total_rounds_played, (e.reason as string | null) ?? null);
  }

  // --- Round start ticks (round_start fires at freeze-time start) ---
  const roundStartRows = parseEvent(demoBuffer, 'round_start', [], []) as { tick: number }[];
  const startTicks = roundStartRows.map((r) => r.tick).sort((a, b) => a - b);
  const startTickFor = (endTick: number, prevEnd: number): number => {
    // last round_start strictly after the previous round end and at/before this end
    let best = prevEnd + 1;
    for (const t of startTicks) {
      if (t > prevEnd && t <= endTick) best = t;
    }
    return best;
  };

  // --- Frames: one batched parseTicks over every wanted tick ---
  const interval = Math.max(1, Math.round(context.tickRate / FRAME_RATE));
  const roundBounds: { round: number; startTick: number; endTick: number; wanted: number[] }[] = [];
  const allWantedTicks: number[] = [];
  let prevEnd = 0;
  for (const r of context.rounds) {
    const startTick = startTickFor(r.endTick, prevEnd);
    const wanted: number[] = [];
    for (let t = startTick; t < r.endTick; t += interval) wanted.push(t);
    wanted.push(r.endTick);
    roundBounds.push({ round: r.roundNumber, startTick, endTick: r.endTick, wanted });
    allWantedTicks.push(...wanted);
    prevEnd = r.endTick;
  }

  const tickRows = parseTicks(
    demoBuffer,
    ['X', 'Y', 'yaw', 'health', 'is_alive', 'active_weapon_name'],
    allWantedTicks,
  ) as Record<string, unknown>[];

  // Group position rows by tick → frame (only rostered players)
  const framesByTick = new Map<number, ReplayPlayerFrame[]>();
  for (const row of tickRows) {
    const pid = playerIdOf(pick<string>(row, ['steamid', 'steamID']));
    if (pid === null) continue;
    const tick = Number(pick<number>(row, ['tick']) ?? -1);
    if (tick < 0) continue;
    const frame: ReplayPlayerFrame = {
      id: pid,
      x: Number(pick<number>(row, ['X', 'x']) ?? 0),
      y: Number(pick<number>(row, ['Y', 'y']) ?? 0),
      yaw: Number(pick<number>(row, ['yaw']) ?? 0),
      hp: Number(pick<number>(row, ['health']) ?? 0),
      alive: Boolean(pick<boolean>(row, ['is_alive']) ?? false),
      weapon: pick<string>(row, ['active_weapon_name']),
    };
    if (!framesByTick.has(tick)) framesByTick.set(tick, []);
    framesByTick.get(tick)!.push(frame);
  }

  // --- Events + grenades, bucketed per round ---
  const eventsByRound = collectEvents(demoBuffer, deathRows, context, playerIdOf, reasonByRound);
  const grenadesByRound = collectGrenades(demoBuffer, context, roundBounds, playerIdOf, interval);

  // --- Assemble rounds ---
  for (const b of roundBounds) {
    const sideInfo = context.rounds.find((r) => r.roundNumber === b.round)!;
    const frames: ReplayFrame[] = b.wanted.map((tick) => ({
      tick,
      players: framesByTick.get(tick) ?? [],
      bomb: null, // live bomb position is a documented Phase-1 limitation (see docs/replay.md)
    }));
    meta.rounds.push({
      round: b.round,
      startTick: b.startTick,
      endTick: b.endTick,
      sideByFaction: {
        SHIRTS: sideForFaction(sideInfo, 'SHIRTS'),
        SKINS: sideForFaction(sideInfo, 'SKINS'),
      },
      frames,
      events: eventsByRound.get(b.round) ?? [],
      grenades: grenadesByRound.get(b.round) ?? [],
    });
  }

  return { payload: meta, warnings: [...new Set(warnings)] };
}

function collectEvents(
  demoBuffer: Buffer,
  deathRows: (PlayerDeathRow & Record<string, unknown>)[],
  context: ReturnType<typeof buildMatchContext>,
  playerIdOf: (s: string | null | undefined) => number | null,
  reasonByRound: Map<number, string | null>,
): Map<number, ReplayEvent[]> {
  const byRound = new Map<number, ReplayEvent[]>();
  const push = (round: number, ev: ReplayEvent) => {
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round)!.push(ev);
  };

  // Kills (mid-round events count rounds completed, so round = +1)
  for (const d of deathRows) {
    if (d.is_warmup_period) continue;
    const round = d.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;
    const ax = pick<number>(d, ['attacker_X']);
    const ay = pick<number>(d, ['attacker_Y']);
    const vx = pick<number>(d, ['user_X']);
    const vy = pick<number>(d, ['user_Y']);
    const victimId = playerIdOf(d.user_steamid);
    if (victimId === null) continue;
    push(round, {
      type: 'kill',
      tick: d.tick,
      attackerId: playerIdOf(d.attacker_steamid),
      victimId,
      assisterId: playerIdOf(d.assister_steamid),
      weapon: pick<string>(d, ['weapon']),
      headshot: Boolean(d.headshot),
      attacker: ax !== null && ay !== null ? { x: Number(ax), y: Number(ay) } : null,
      victim: vx !== null && vy !== null ? { x: Number(vx), y: Number(vy) } : null,
    });
  }

  // Bomb plants / defuses
  const plantRows = parseEvent(demoBuffer, 'bomb_planted', ['X', 'Y'], [
    'total_rounds_played',
    'site',
  ]) as Record<string, unknown>[];
  for (const p of plantRows) {
    const round = Number(p.total_rounds_played ?? -1) + 1;
    if (!context.liveRounds.has(round)) continue;
    const siteRaw = pick<unknown>(p, ['site']);
    const site = siteRaw === 0 || siteRaw === 'A' ? 'A' : siteRaw === 1 || siteRaw === 'B' ? 'B' : null;
    push(round, {
      type: 'plant',
      tick: Number(p.tick ?? 0),
      playerId: playerIdOf(pick<string>(p, ['user_steamid'])),
      site,
      x: Number(pick<number>(p, ['user_X', 'X']) ?? 0),
      y: Number(pick<number>(p, ['user_Y', 'Y']) ?? 0),
    });
  }

  const defuseRows = parseEvent(demoBuffer, 'bomb_defused', ['X', 'Y'], [
    'total_rounds_played',
  ]) as Record<string, unknown>[];
  for (const d of defuseRows) {
    const round = Number(d.total_rounds_played ?? -1) + 1;
    if (!context.liveRounds.has(round)) continue;
    push(round, {
      type: 'defuse',
      tick: Number(d.tick ?? 0),
      playerId: playerIdOf(pick<string>(d, ['user_steamid'])),
      x: Number(pick<number>(d, ['user_X', 'X']) ?? 0),
      y: Number(pick<number>(d, ['user_Y', 'Y']) ?? 0),
    });
  }

  // Round ends (round_end uses total_rounds_played as the round that ended)
  for (const r of context.rounds) {
    const condition = reasonToCondition(reasonByRound.get(r.roundNumber) ?? null);
    const winnerSide = r.winnerSide;
    let winnerFaction: Faction | null = null;
    if (winnerSide) winnerFaction = winnerSide === r.shirtsSide ? 'SHIRTS' : 'SKINS';
    push(r.roundNumber, {
      type: 'round_end',
      tick: r.endTick,
      winnerSide: winnerSide as Side | null,
      winnerFaction,
      condition,
    });
  }

  // Keep each round's events tick-ordered for the timeline / events list.
  for (const evs of byRound.values()) evs.sort((a, b) => a.tick - b.tick);
  return byRound;
}

function collectGrenades(
  demoBuffer: Buffer,
  context: ReturnType<typeof buildMatchContext>,
  roundBounds: { round: number; startTick: number; endTick: number }[],
  playerIdOf: (s: string | null | undefined) => number | null,
  interval: number,
): Map<number, ReplayGrenade[]> {
  const byRound = new Map<number, ReplayGrenade[]>();
  let rows: Record<string, unknown>[];
  try {
    rows = parseGrenades(demoBuffer) as Record<string, unknown>[];
  } catch {
    return byRound; // grenades are non-critical for Phase 1
  }

  const roundForTick = (tick: number): number | null => {
    for (const b of roundBounds) {
      if (tick >= b.startTick && tick <= b.endTick) return b.round;
    }
    return null;
  };

  // Field names vary across props, so read defensively via pick() — same as the
  // frame/event collectors (the parser may emit X/Y/Z capitalized like parseTicks).
  const gx = (r: Record<string, unknown>) => pick<number>(r, ['x', 'X']);
  const gy = (r: Record<string, unknown>) => pick<number>(r, ['y', 'Y']);
  const gz = (r: Record<string, unknown>) => pick<number>(r, ['z', 'Z']);
  const gtick = (r: Record<string, unknown>) => Number(pick<number>(r, ['tick']) ?? 0);

  // parseGrenades emits one row per tick per live grenade entity, with x/y/z null
  // while the projectile isn't in flight (held / already detonated). Entity ids are
  // RECYCLED across rounds, so group by (round, entity) — within a round an entity
  // is a single throw — and keep only located points.
  const byThrow = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    if (gx(r) === null) continue; // unlocated tick
    const id = Number(pick<number>(r, ['grenade_entity_id', 'entity_id']) ?? -1);
    if (id < 0) continue;
    const round = roundForTick(gtick(r));
    if (round === null || !context.liveRounds.has(round)) continue;
    const key = `${round}:${id}`;
    if (!byThrow.has(key)) byThrow.set(key, []);
    byThrow.get(key)!.push(r);
  }

  for (const [key, points] of byThrow) {
    const round = Number(key.split(':')[0]);
    points.sort((a, b) => gtick(a) - gtick(b));
    const first = points[0];

    // Downsample by interval and collapse stationary runs (a settled smoke sits
    // at one spot for hundreds of ticks — one point is enough).
    const trajectory: GrenadePoint[] = [];
    let lastTick = -Infinity;
    let lastX = NaN;
    let lastY = NaN;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const tick = gtick(p);
      const x = Number(gx(p) ?? 0);
      const y = Number(gy(p) ?? 0);
      const isLast = i === points.length - 1;
      const moved = x !== lastX || y !== lastY;
      if (!isLast) {
        if (!moved) continue; // stationary (settled smoke/molotov) → collapse
        if (tick - lastTick < interval) continue; // dense flight → downsample
      }
      lastTick = tick;
      lastX = x;
      lastY = y;
      trajectory.push({ tick, x, y, z: Number(gz(p) ?? 0) });
    }

    const grenade: ReplayGrenade = {
      // grenade_type is the engine class name, e.g. "CSmokeGrenade" (`name` is the
      // thrower's display name, not the grenade).
      type: normGrenadeType(pick<string>(first, ['grenade_type'])),
      throwerId: playerIdOf(pick<string>(first, ['steamid', 'steamID'])),
      trajectory,
      detonateTick: gtick(points[points.length - 1]),
    };
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round)!.push(grenade);
  }

  return byRound;
}
