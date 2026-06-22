// The `replay.json` contract.
//
// This file is the doc-of-record-in-code for the 2D replay payload (issue #121).
// The extract code (`src/lib/replay/extract.ts`), the GitHub `replay-extract` Action,
// the client `<ReplayPlayer>`, and the on-demand `replay-mp4` Action all contract
// against these types — lock the shape here before changing any of them.
//
// See `docs/replay.md` for the prose doc-of-record and `docs/calculations.md` for
// the side/faction rules these reuse.

import type { Faction, RoundCondition } from '../types';

export type Side = 'CT' | 'T';

/**
 * Bump when the shape changes incompatibly. The player reads this and refuses
 * payloads it doesn't understand instead of mis-rendering.
 */
export const REPLAY_SCHEMA_VERSION = 1;

/** A 2D world position, in CS2 world units (not yet projected to a radar). */
export interface Point {
  x: number;
  y: number;
}

/** Top-level payload, one per match, stored gzipped at R2 `<matchId>/replay.json`. */
export interface ReplayPayload {
  version: number; // === REPLAY_SCHEMA_VERSION
  matchId: number;
  map: string; // raw map name as stored on the match (compare case-insensitively)
  /** Engine ticks per second (from the demo header), e.g. 64. */
  tickRate: number;
  /** Frames per second after downsampling — playback cadence, e.g. 16. */
  frameRate: number;
  /** Roster metadata, display-only. Frames/events reference players by `id`. */
  players: ReplayPlayerMeta[];
  rounds: ReplayRound[];
}

/** One rostered player. `id` is the DGLS `player_id` used everywhere else. */
export interface ReplayPlayerMeta {
  id: number;
  name: string;
  faction: Faction;
  steamId: string | null;
}

export interface ReplayRound {
  /** 1-based round number (matches `total_rounds_played`). */
  round: number;
  startTick: number;
  endTick: number;
  /** Which side each faction played this round (regulation/OT swaps already applied). */
  sideByFaction: Record<Faction, Side>;
  /** Positional snapshots, downsampled to `frameRate`. */
  frames: ReplayFrame[];
  /** Core events — powers BOTH the Events tab and the in-player timeline. */
  events: ReplayEvent[];
  grenades: ReplayGrenade[];
}

/** A single downsampled tick: where everyone is and what the bomb is doing. */
export interface ReplayFrame {
  tick: number;
  players: ReplayPlayerFrame[];
  /** `null` until the bomb's position is known (see `docs/replay.md` limitations). */
  bomb: ReplayBomb | null;
}

export interface ReplayPlayerFrame {
  id: number;
  x: number;
  y: number;
  /** Facing direction in degrees (eye yaw). */
  yaw: number;
  hp: number;
  alive: boolean;
  /** Active weapon name (e.g. `weapon_ak47`), or `null` if unknown. */
  weapon: string | null;
}

export interface ReplayBomb {
  x: number;
  y: number;
  /** Held by a player (vs. dropped on the ground). */
  carried: boolean;
  planted: boolean;
}

export type ReplayEventType = 'kill' | 'plant' | 'defuse' | 'round_end';

interface ReplayEventBase {
  tick: number;
  type: ReplayEventType;
}

export interface ReplayKillEvent extends ReplayEventBase {
  type: 'kill';
  /** `null` for world/suicide kills. */
  attackerId: number | null;
  victimId: number;
  assisterId: number | null;
  weapon: string | null;
  headshot: boolean;
  /** Positions power the kill-feed tracer; attacker may be unknown. */
  attacker: Point | null;
  victim: Point | null;
}

export interface ReplayPlantEvent extends ReplayEventBase {
  type: 'plant';
  playerId: number | null;
  site: 'A' | 'B' | null;
  x: number;
  y: number;
}

export interface ReplayDefuseEvent extends ReplayEventBase {
  type: 'defuse';
  playerId: number | null;
  x: number;
  y: number;
}

export interface ReplayRoundEndEvent extends ReplayEventBase {
  type: 'round_end';
  winnerSide: Side | null;
  winnerFaction: Faction | null;
  /** How the round was won (drives the icon), reusing the match `RoundCondition` set. */
  condition: RoundCondition;
}

export type ReplayEvent =
  | ReplayKillEvent
  | ReplayPlantEvent
  | ReplayDefuseEvent
  | ReplayRoundEndEvent;

export interface ReplayGrenade {
  /** Normalized type: `smoke` | `flashbang` | `he` | `molotov` | `incendiary` | `decoy`. */
  type: string;
  throwerId: number | null;
  /** Downsampled flight path. */
  trajectory: GrenadePoint[];
  detonateTick: number | null;
}

export interface GrenadePoint {
  tick: number;
  x: number;
  y: number;
  z: number;
}
