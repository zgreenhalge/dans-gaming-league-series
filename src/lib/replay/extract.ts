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
  type ReplayShot,
  type ReplayBlind,
  type ReplayHurt,
  type BombCarrierPoint,
  type GrenadePoint,
  type Side,
} from './types';

/** Target playback cadence. Frames are downsampled from tickRate to this. */
const FRAME_RATE = 16;

/** Seconds of lead kept before a round goes live; the rest of freeze time is skipped. */
const PRE_LIVE_SECONDS = 1;

/**
 * Seconds of play kept after `round_end` — the post-round window where players keep
 * moving before the next freeze. Capped at the next `round_start` so we never bleed
 * back into the (trimmed) freeze time of the following round.
 */
const POST_ROUND_SECONDS = 7;

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

/** True for firearms (which fire bullets → tracers), false for grenades/knives. */
function isBulletWeapon(weapon: string | null): boolean {
  const w = (weapon ?? '').toLowerCase();
  if (!w) return false; // unknown weapon → no tracer (safer than a spurious one)
  return !/grenade|molotov|incgren|flashbang|smoke|decoy|knife|bayonet|fists|breachcharge|bump|tablet|healthshot|zone/.test(
    w,
  );
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
  /** Informational lines (e.g. capture counts) — surfaced as ::notice, not ::warning. */
  notices: string[];
}

export function buildReplay(input: BuildReplayInput): BuildReplayResult {
  const { demoBuffer, matchId, map, roster, skinsSide, targetWinRounds } = input;
  const warnings: string[] = [];
  const notices: string[] = [];

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
    return { payload: meta, warnings: [...new Set(warnings)], notices: [...new Set(notices)] };
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

  // --- Freeze-end ticks: a round is in freeze/buy time (~15s) between round_start
  // and round_freeze_end, with everyone standing in spawn — dead air we don't want
  // to play back. We keep only a short lead before live (see PRE_LIVE_SECONDS). ---
  let freezeEndTicks: number[] = [];
  try {
    const rows = parseEvent(demoBuffer, 'round_freeze_end', [], []) as { tick: number }[];
    freezeEndTicks = rows.map((r) => r.tick).sort((a, b) => a - b);
  } catch {
    warnings.push('No round_freeze_end events — replay keeps full freeze time.');
  }
  const freezeEndIn = (startTick: number, endTick: number): number | null => {
    for (const t of freezeEndTicks) if (t > startTick && t <= endTick) return t;
    return null;
  };
  // First round_start strictly after a round's end — the start of the next freeze,
  // which caps how far we extend post-round playback.
  const nextStartAfter = (endTick: number): number | null => {
    for (const t of startTicks) if (t > endTick) return t;
    return null;
  };

  // --- Frames: one batched parseTicks over every wanted tick ---
  const interval = Math.max(1, Math.round(context.tickRate / FRAME_RATE));
  const leadTicks = Math.round(context.tickRate * PRE_LIVE_SECONDS);
  const postRoundTicks = Math.round(context.tickRate * POST_ROUND_SECONDS);
  const roundBounds: {
    round: number;
    startTick: number;
    /** The `round_end` tick (semantic round end; events reference it). */
    endTick: number;
    /** Last tick of playback, including the post-round window (≥ `endTick`). */
    frameEndTick: number;
    wanted: number[];
  }[] = [];
  const allWantedTicks: number[] = [];
  let prevEnd = 0;
  for (const r of context.rounds) {
    const roundStart = startTickFor(r.endTick, prevEnd);
    prevEnd = r.endTick;
    // Begin playback ~PRE_LIVE_SECONDS before the round goes live, skipping the
    // freeze/buy dead time. Fall back to round_start if no freeze-end is known.
    const freezeEnd = freezeEndIn(roundStart, r.endTick);
    const startTick =
      freezeEnd !== null ? Math.max(roundStart, freezeEnd - leadTicks) : roundStart;
    // Keep playing through the post-round, but never into the next freeze.
    const nextStart = nextStartAfter(r.endTick);
    const frameEndTick =
      nextStart !== null
        ? Math.min(r.endTick + postRoundTicks, nextStart)
        : r.endTick + postRoundTicks;
    const wanted: number[] = [];
    for (let t = startTick; t < r.endTick; t += interval) wanted.push(t);
    wanted.push(r.endTick);
    for (let t = r.endTick + interval; t <= frameEndTick; t += interval) wanted.push(t);
    roundBounds.push({ round: r.roundNumber, startTick, endTick: r.endTick, frameEndTick, wanted });
    allWantedTicks.push(...wanted);
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

  // --- Events + grenades + shots, bucketed per round ---
  const eventsByRound = collectEvents(demoBuffer, deathRows, context, playerIdOf, reasonByRound);
  const grenadesByRound = collectGrenades(demoBuffer, context, roundBounds, playerIdOf, interval);
  const shotsByRound = collectShots(demoBuffer, context, playerIdOf);
  const blindsByRound = collectBlinds(demoBuffer, context, playerIdOf);
  const hurtsByRound = collectHurts(demoBuffer, context, playerIdOf);
  const { byRound: bombCarrierByRound, seededRounds } = collectBombCarrier(
    demoBuffer,
    context,
    roundBounds,
    playerIdOf,
  );

  // Capture counts surface in the Action's `assemble` stage — an empty array here is
  // the first sign a parser field name drifted (collectors fail soft / skip silently).
  const sumLengths = (m: Map<number, readonly unknown[]>): number =>
    [...m.values()].reduce((n, a) => n + a.length, 0);
  const nShots = sumLengths(shotsByRound);
  const nBlinds = sumLengths(blindsByRound);
  const nHurts = sumLengths(hurtsByRound);
  const nGrenades = sumLengths(grenadesByRound);
  notices.push(
    `Captured ${nShots} shots, ${nBlinds} blinds, ${nHurts} hurts, ${nGrenades} grenades.`,
  );
  if (nShots === 0) warnings.push('No shots captured — bullet tracers will be absent (weapon_fire?).');
  if (nBlinds === 0) warnings.push('No blinds captured — flash overlay will be absent (player_blind?).');
  if (nHurts === 0) warnings.push('No hurts captured — damage blink will be absent (player_hurt?).');
  notices.push(`Seeded the bomb carrier in ${seededRounds}/${context.rounds.length} rounds.`);
  if (seededRounds === 0)
    warnings.push('No bomb carrier seeded in any round — check the `inventory` tick prop.');

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
      shots: shotsByRound.get(b.round) ?? [],
      blinds: blindsByRound.get(b.round) ?? [],
      hurts: hurtsByRound.get(b.round) ?? [],
      bombCarrier: bombCarrierByRound.get(b.round) ?? [],
    });
  }

  return { payload: meta, warnings: [...new Set(warnings)], notices: [...new Set(notices)] };
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
  roundBounds: { round: number; startTick: number; frameEndTick: number }[],
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
      if (tick >= b.startTick && tick <= b.frameEndTick) return b.round;
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

    // Detonation = when the projectile reaches its final resting spot, NOT the last
    // emitted tick. parseGrenades can keep emitting a settled projectile's position
    // long after it lands; using the last tick would make a smoke/fire bloom late and
    // leave the in-flight dot parked at the bloom for seconds. Use the first tick the
    // projectile is at its final position (for air-bursts that's just the last point).
    const lastPt = points[points.length - 1];
    const restX = gx(lastPt);
    const restY = gy(lastPt);
    let detonateTick = gtick(lastPt);
    for (const p of points) {
      if (gx(p) === restX && gy(p) === restY) {
        detonateTick = gtick(p);
        break;
      }
    }

    const grenade: ReplayGrenade = {
      // grenade_type is the engine class name, e.g. "CSmokeGrenade" (`name` is the
      // thrower's display name, not the grenade).
      type: normGrenadeType(pick<string>(first, ['grenade_type'])),
      throwerId: playerIdOf(pick<string>(first, ['steamid', 'steamID'])),
      trajectory,
      detonateTick,
    };
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round)!.push(grenade);
  }

  return byRound;
}

/**
 * Every bullet fired, bucketed per round. `weapon_fire` is a mid-round event so it
 * counts rounds *completed* — the round it belongs to is `total_rounds_played + 1`,
 * same as kills. We pull the shooter's position + eye yaw to cast the 2D tracer.
 */
function collectShots(
  demoBuffer: Buffer,
  context: ReturnType<typeof buildMatchContext>,
  playerIdOf: (s: string | null | undefined) => number | null,
): Map<number, ReplayShot[]> {
  const byRound = new Map<number, ReplayShot[]>();
  let rows: Record<string, unknown>[];
  try {
    rows = parseEvent(demoBuffer, 'weapon_fire', [], [
      'total_rounds_played',
      'is_warmup_period',
      'weapon',
    ]) as Record<string, unknown>[];
  } catch {
    return byRound; // shots are non-critical
  }

  for (const f of rows) {
    if (f.is_warmup_period) continue;
    // `weapon_fire` also fires for grenade throws and knife swings — those aren't
    // bullets and shouldn't draw a tracer. Skip anything that isn't a firearm.
    if (!isBulletWeapon(pick<string>(f, ['weapon']))) continue;
    const round = Number(f.total_rounds_played ?? -1) + 1;
    if (!context.liveRounds.has(round)) continue;
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round)!.push({
      tick: Number(pick<number>(f, ['tick']) ?? 0),
      shooterId: playerIdOf(pick<string>(f, ['user_steamid'])),
    });
  }

  for (const shots of byRound.values()) shots.sort((a, b) => a.tick - b.tick);
  return byRound;
}

/**
 * Flash events, bucketed per round. `player_blind` carries `blind_duration` (seconds);
 * the player renders a whiteout that fades to team color over that span. Mid-round
 * event, so the round is `total_rounds_played + 1` (same as kills/shots).
 */
function collectBlinds(
  demoBuffer: Buffer,
  context: ReturnType<typeof buildMatchContext>,
  playerIdOf: (s: string | null | undefined) => number | null,
): Map<number, ReplayBlind[]> {
  const byRound = new Map<number, ReplayBlind[]>();
  let rows: Record<string, unknown>[];
  try {
    rows = parseEvent(demoBuffer, 'player_blind', [], [
      'total_rounds_played',
      'is_warmup_period',
      'blind_duration',
    ]) as Record<string, unknown>[];
  } catch {
    return byRound; // non-critical
  }

  for (const b of rows) {
    if (b.is_warmup_period) continue;
    const round = Number(b.total_rounds_played ?? -1) + 1;
    if (!context.liveRounds.has(round)) continue;
    const duration = Number(pick<number>(b, ['blind_duration']) ?? 0);
    if (duration <= 0) continue;
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round)!.push({
      tick: Number(pick<number>(b, ['tick']) ?? 0),
      playerId: playerIdOf(pick<string>(b, ['user_steamid'])),
      duration,
    });
  }

  for (const blinds of byRound.values()) blinds.sort((a, b) => a.tick - b.tick);
  return byRound;
}

/**
 * Damage events, bucketed per round. `player_hurt` fires once per damage instance —
 * fire (inferno) ticks repeatedly, so a short red blink per hurt reads as a sustained
 * burn. Mid-round event, so the round is `total_rounds_played + 1`.
 */
function collectHurts(
  demoBuffer: Buffer,
  context: ReturnType<typeof buildMatchContext>,
  playerIdOf: (s: string | null | undefined) => number | null,
): Map<number, ReplayHurt[]> {
  const byRound = new Map<number, ReplayHurt[]>();
  let rows: Record<string, unknown>[];
  try {
    rows = parseEvent(demoBuffer, 'player_hurt', [], [
      'total_rounds_played',
      'is_warmup_period',
    ]) as Record<string, unknown>[];
  } catch {
    return byRound; // non-critical
  }

  for (const h of rows) {
    if (h.is_warmup_period) continue;
    const round = Number(h.total_rounds_played ?? -1) + 1;
    if (!context.liveRounds.has(round)) continue;
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round)!.push({
      tick: Number(pick<number>(h, ['tick']) ?? 0),
      playerId: playerIdOf(pick<string>(h, ['user_steamid'])),
    });
  }

  for (const hurts of byRound.values()) hurts.sort((a, b) => a.tick - b.tick);
  return byRound;
}

/**
 * Bomb-carrier change-points per round. We don't read `inventory` every tick (heavy);
 * instead we *seed* the round-start carrier by checking `inventory` for `weapon_c4` at
 * the round's first rendered tick, then track changes from `bomb_pickup`/`bomb_dropped`
 * (a drop is `carrierId: null`). The plant is read from `events` separately. Positions
 * aren't stored — `bombStateAt()` derives them from the carrier's frames. Returns the
 * map plus how many rounds got a seed (a zero count flags an `inventory` field issue).
 */
function collectBombCarrier(
  demoBuffer: Buffer,
  context: ReturnType<typeof buildMatchContext>,
  roundBounds: { round: number; startTick: number }[],
  playerIdOf: (s: string | null | undefined) => number | null,
): { byRound: Map<number, BombCarrierPoint[]>; seededRounds: number } {
  const byRound = new Map<number, BombCarrierPoint[]>();
  const push = (round: number, p: BombCarrierPoint) => {
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round)!.push(p);
  };

  // 1) Seed: who holds weapon_c4 at each round's first rendered tick.
  const roundBySeedTick = new Map(roundBounds.map((b) => [b.startTick, b.round]));
  try {
    const seedTicks = roundBounds.map((b) => b.startTick);
    const rows = parseTicks(demoBuffer, ['inventory'], seedTicks) as Record<string, unknown>[];
    for (const row of rows) {
      const tick = Number(pick<number>(row, ['tick']) ?? -1);
      const round = roundBySeedTick.get(tick);
      if (round === undefined || !context.liveRounds.has(round)) continue;
      const inv = pick<unknown[]>(row, ['inventory']);
      if (!Array.isArray(inv)) continue;
      if (!inv.some((w) => typeof w === 'string' && /c4/i.test(w))) continue;
      const carrierId = playerIdOf(pick<string>(row, ['steamid', 'steamID']));
      push(round, { tick, carrierId });
    }
  } catch {
    /* inventory prop unsupported — no seed; events still apply */
  }
  const seededRounds = byRound.size;

  // 2) Pickups + drops (mid-round events → round = total_rounds_played + 1).
  const carrierEvent = (name: string, toCarrier: (e: Record<string, unknown>) => number | null) => {
    let rows: Record<string, unknown>[];
    try {
      rows = parseEvent(demoBuffer, name, [], [
        'total_rounds_played',
        'is_warmup_period',
      ]) as Record<string, unknown>[];
    } catch {
      return;
    }
    for (const e of rows) {
      if (e.is_warmup_period) continue;
      const round = Number(e.total_rounds_played ?? -1) + 1;
      if (!context.liveRounds.has(round)) continue;
      push(round, { tick: Number(pick<number>(e, ['tick']) ?? 0), carrierId: toCarrier(e) });
    }
  };
  carrierEvent('bomb_pickup', (e) => playerIdOf(pick<string>(e, ['user_steamid'])));
  carrierEvent('bomb_dropped', () => null);

  for (const pts of byRound.values()) pts.sort((a, b) => a.tick - b.tick);
  return { byRound, seededRounds };
}
