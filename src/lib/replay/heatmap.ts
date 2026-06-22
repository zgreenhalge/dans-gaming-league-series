// Derive a compact per-match heatmap artifact from a replay payload.
//
// The map page's Heatmap tab (issue #121 comment) plots kill/death/grenade
// locations, filterable by season + side. Rather than have that page download
// multi-MB `replay.json` payloads, the extract Action writes this tiny `points.json`
// next to it (one row per located event), and the tab aggregates those small files.
//
// Pure and runtime-agnostic — the Action builds it from the SAME payload the player
// reads, so there is no second source of truth. See `docs/replay.md`.

import type { ReplayPayload, Side } from './types';
import type { Faction } from '../types';
import { sideOfPlayer } from './playback';

/** Bump when the artifact shape changes incompatibly. */
export const HEATMAP_SCHEMA_VERSION = 1;

/** Point kinds: where players died / shot from, and where grenades went off. */
export type HeatmapKind =
  | 'kill' // attacker position at a kill
  | 'death' // victim position at a kill
  | 'smoke'
  | 'molotov'
  | 'incendiary'
  | 'flashbang'
  | 'he'
  | 'decoy';

const GRENADE_KINDS = new Set<HeatmapKind>([
  'smoke',
  'molotov',
  'incendiary',
  'flashbang',
  'he',
  'decoy',
]);

export interface HeatmapPoint {
  kind: HeatmapKind;
  x: number;
  y: number;
  round: number;
  /** Side of the actor this round (attacker for `kill`, victim for `death`, thrower for grenades). */
  side: Side | null;
  faction: Faction | null;
}

export interface HeatmapArtifact {
  version: number; // === HEATMAP_SCHEMA_VERSION
  matchId: number;
  map: string;
  points: HeatmapPoint[];
}

/**
 * Extract every located kill/death/grenade point from a payload. Season isn't stored
 * here — the heatmap tab knows each match's season and filters on it; this artifact
 * only carries what the payload itself provides (position + side/faction + round).
 */
export function buildHeatmapPoints(payload: ReplayPayload): HeatmapArtifact {
  const factionById = new Map(payload.players.map((p) => [p.id, p.faction]));
  const points: HeatmapPoint[] = [];

  for (const round of payload.rounds) {
    const sideFor = (id: number | null): { side: Side | null; faction: Faction | null } => {
      const faction = id !== null ? factionById.get(id) ?? null : null;
      return { side: sideOfPlayer(round, faction), faction };
    };

    for (const ev of round.events) {
      if (ev.type !== 'kill') continue;
      if (ev.victim) {
        const { side, faction } = sideFor(ev.victimId);
        points.push({ kind: 'death', x: ev.victim.x, y: ev.victim.y, round: round.round, side, faction });
      }
      if (ev.attacker && ev.attackerId !== null) {
        const { side, faction } = sideFor(ev.attackerId);
        points.push({ kind: 'kill', x: ev.attacker.x, y: ev.attacker.y, round: round.round, side, faction });
      }
    }

    for (const g of round.grenades) {
      if (g.trajectory.length === 0) continue;
      if (!GRENADE_KINDS.has(g.type as HeatmapKind)) continue; // skip 'unknown'
      // Detonation ≈ the last located point of the flight path.
      const at = g.trajectory[g.trajectory.length - 1];
      const { side, faction } = sideFor(g.throwerId);
      points.push({ kind: g.type as HeatmapKind, x: at.x, y: at.y, round: round.round, side, faction });
    }
  }

  return { version: HEATMAP_SCHEMA_VERSION, matchId: payload.matchId, map: payload.map, points };
}
