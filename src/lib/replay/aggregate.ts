// One player's movement across many rounds, time-zeroed to each round's own start so
// they can all play back on a single shared clock — the "replay all of a player's
// rounds in aggregate" mode (issue #128). Pure and runtime-agnostic like the rest of
// `src/lib/replay/` (no DOM, no fetch): callers extract a `PlayerTrace[]` either from a
// single already-fetched `ReplayPayload` (a match's own rounds) or by fanning out over
// several matches' payloads (a player's whole history on a map) — see `docs/replay.md`.

import type { ReplayPayload, ReplayRound, Side } from './types';
import type { Faction } from '../types';
import { roundTickRange, sideOfPlayer, lerp, lerpAngle, bracketBy } from './playback';

/** One player's interpolatable position/state at a moment, offset from round start. */
export interface TraceFrame {
  /** Ticks elapsed since the round's playback window started (0-based, unlike raw demo ticks). */
  t: number;
  x: number;
  y: number;
  yaw: number;
  hp: number;
  alive: boolean;
}

/** A single round's worth of one player's movement, so many rounds — even from
 *  different matches — can share one playback clock zeroed to each round's start. */
export interface PlayerTrace {
  matchId: number;
  round: number;
  side: Side | null;
  /** Ticks the round's playback window lasted; frames[].t ranges 0..durationTicks. */
  durationTicks: number;
  frames: TraceFrame[];
}

/** A trace's interpolated state at time `t`, or `null` once past its own round's end. */
export interface TraceState {
  x: number;
  y: number;
  yaw: number;
  hp: number;
  alive: boolean;
}

/**
 * Extract one player's positional trace from a round, or `null` if they have no
 * frames this round (didn't play, e.g. sat out a knife round on the other side).
 *
 * Stops at the player's death: once a frame reports them dead, one final frame is
 * appended *frozen at their last known-alive position* (not whatever the engine
 * reports for a dead player, which can drift back toward spawn — `extract.ts`
 * already freezes this at the source, but this is the same freeze applied
 * defensively here too) and no further frames are read. `traceStateAt`'s
 * end-of-frames clamp then holds that frozen position for the rest of the round, so
 * the dot reads as a corpse marker where they actually died instead of jumping
 * partway back to spawn.
 *
 * Survivors stop at the round's `endTick` (the `round_end` tick) for the same reason:
 * `round.frames` (`extract.ts`) deliberately keeps a few seconds *after* `round_end` so
 * the single-round 2D Replay can show the post-round window, but during that window CS2
 * resets players toward their next-round spawn — movement that isn't part of the round
 * itself. Reading past `endTick` would make a survivor's ghost snap back toward spawn
 * instead of staying put where the round actually ended.
 */
export function extractPlayerTrace(
  matchId: number,
  round: ReplayRound,
  playerId: number,
  faction: Faction | null,
): PlayerTrace | null {
  const range = roundTickRange(round);
  const frames: TraceFrame[] = [];
  for (const f of round.frames) {
    if (f.tick > round.endTick) break;
    const p = f.players.find((pp) => pp.id === playerId);
    if (!p) continue;
    if (!p.alive) {
      // Freeze at the last alive position; if they were already dead on their very
      // first appearing frame (no prior alive position to freeze at), fall back to
      // this frame's own position rather than dropping the round's trace entirely —
      // it may itself be reset toward spawn, but a rough corpse marker beats the
      // round silently vanishing from the overlay and its round count.
      const last = frames[frames.length - 1] ?? p;
      frames.push({ t: f.tick - range.start, x: last.x, y: last.y, yaw: last.yaw, hp: 0, alive: false });
      break;
    }
    frames.push({ t: f.tick - range.start, x: p.x, y: p.y, yaw: p.yaw, hp: p.hp, alive: true });
  }
  if (frames.length === 0) return null;
  return {
    matchId,
    round: round.round,
    side: sideOfPlayer(round, faction),
    durationTicks: range.end - range.start,
    frames,
  };
}

const traceFrameT = (f: TraceFrame) => f.t;

/** A trace's interpolated state at shared-clock time `t` (ticks since its round started). */
export function traceStateAt(trace: PlayerTrace, t: number): TraceState | null {
  if (t < 0 || t > trace.durationTicks) return null;
  const b = bracketBy(trace.frames, traceFrameT, t);
  if (!b) return null;
  return {
    x: lerp(b.lo.x, b.hi.x, b.t),
    y: lerp(b.lo.y, b.hi.y, b.t),
    yaw: lerpAngle(b.lo.yaw, b.hi.yaw, b.t),
    hp: b.t < 0.5 ? b.lo.hp : b.hi.hp,
    alive: b.t < 0.5 ? b.lo.alive : b.hi.alive,
  };
}

/** Longest round in the set, for the overlay's shared scrubber/clock range. */
export function maxDurationTicks(traces: PlayerTrace[]): number {
  return traces.reduce((max, t) => Math.max(max, t.durationTicks), 0);
}

/** Bump when the per-match trace artifact shape changes incompatibly. */
export const TRACE_SCHEMA_VERSION = 1;

/** Bump when the map-level trace rollup artifact shape changes incompatibly (see `queries/replay.ts`). */
export const MAP_TRACE_ROLLUP_VERSION = 1;

/** One rostered player's traces for a match, tagged so a multi-player artifact can be filtered. */
export interface MatchPlayerTraces {
  playerId: number;
  faction: Faction;
  traces: PlayerTrace[];
}

/**
 * A match's compact per-player trace artifact (issue #127's Pathing-tab extension) —
 * every rostered player's `PlayerTrace[]`, derived from the same payload the 2D
 * Replay player reads. The Pathing tab only ever needs positions, not the full
 * `replay.json` (events, grenades, shots, blinds, hurts), so this is a much smaller
 * object to fan out over than the full payload.
 */
export interface MatchTraceArtifact {
  version: number; // === TRACE_SCHEMA_VERSION
  matchId: number;
  map: string;
  tickRate: number;
  players: MatchPlayerTraces[];
}

/** Extract every rostered player's traces from a payload — the Action's `traces` stage. */
export function buildMatchTraces(payload: ReplayPayload): MatchTraceArtifact {
  const players: MatchPlayerTraces[] = payload.players.map((p) => {
    const traces: PlayerTrace[] = [];
    for (const round of payload.rounds) {
      const trace = extractPlayerTrace(payload.matchId, round, p.id, p.faction);
      if (trace) traces.push(trace);
    }
    return { playerId: p.id, faction: p.faction, traces };
  });
  return {
    version: TRACE_SCHEMA_VERSION,
    matchId: payload.matchId,
    map: payload.map,
    tickRate: payload.tickRate,
    players,
  };
}
