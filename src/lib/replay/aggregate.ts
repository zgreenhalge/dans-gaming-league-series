// One player's movement across many rounds, time-zeroed to each round's own start so
// they can all play back on a single shared clock — the "replay all of a player's
// rounds in aggregate" mode (issue #128). Pure and runtime-agnostic like the rest of
// `src/lib/replay/` (no DOM, no fetch): callers extract a `PlayerTrace[]` either from a
// single already-fetched `ReplayPayload` (a match's own rounds) or by fanning out over
// several matches' payloads (a player's whole history on a map) — see `docs/replay.md`.

import type { ReplayRound, Side } from './types';
import type { Faction } from '../types';
import { roundTickRange, sideOfPlayer, lerp, lerpAngle } from './playback';

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
  isKnifeRound?: boolean;
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
    isKnifeRound: round.isKnifeRound,
    side: sideOfPlayer(round, faction),
    durationTicks: range.end - range.start,
    frames,
  };
}

/** A trace's interpolated state at shared-clock time `t` (ticks since its round started). */
export function traceStateAt(trace: PlayerTrace, t: number): TraceState | null {
  const frames = trace.frames;
  if (t < 0 || t > trace.durationTicks || frames.length === 0) return null;
  if (t <= frames[0].t) return { ...frames[0] };
  const last = frames[frames.length - 1];
  if (t >= last.t) return { ...last };
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].t >= t) {
      const lo = frames[i - 1];
      const hi = frames[i];
      const span = hi.t - lo.t || 1;
      const frac = (t - lo.t) / span;
      return {
        x: lerp(lo.x, hi.x, frac),
        y: lerp(lo.y, hi.y, frac),
        yaw: lerpAngle(lo.yaw, hi.yaw, frac),
        hp: frac < 0.5 ? lo.hp : hi.hp,
        alive: frac < 0.5 ? lo.alive : hi.alive,
      };
    }
  }
  return { ...last };
}

/** Longest round in the set, for the overlay's shared scrubber/clock range. */
export function maxDurationTicks(traces: PlayerTrace[]): number {
  return traces.reduce((max, t) => Math.max(max, t.durationTicks), 0);
}
