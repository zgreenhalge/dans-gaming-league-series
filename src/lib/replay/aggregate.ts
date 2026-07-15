// One player's movement across many rounds, time-zeroed to each round's own start so
// they can all play back on a single shared clock — the "replay all of a player's
// rounds in aggregate" mode (issue #128). Pure and runtime-agnostic like the rest of
// `src/lib/replay/` (no DOM, no fetch): callers extract a `PlayerTrace[]` either from a
// single already-fetched `ReplayPayload` (a match's own rounds) or by fanning out over
// several matches' payloads (a player's whole history on a map) — see `docs/replay.md`.

import type { ReplayRound, Side } from './types';
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
    const p = f.players.find((pp) => pp.id === playerId);
    if (!p) continue;
    frames.push({ t: f.tick - range.start, x: p.x, y: p.y, yaw: p.yaw, hp: p.hp, alive: p.alive });
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
