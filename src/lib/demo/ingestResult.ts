// Shape of the pending demo-ingest result stored in R2 (`demoResultKey`) by the demo-ingest Action
// and read by the in-match review block. Transient — deleted on confirm/dismiss. No DB schema.

import type { DemoSabremetricStat, RoundHistoryEntry } from '../types';

/** Confirm-ready payload — exactly the `PATCH /api/matches/[id]/score` request body. */
export interface DemoConfirmPayload {
  shirts: number;
  skins: number;
  player_stats: {
    player_id: number;
    kills: number;
    assists: number;
    deaths: number;
    damage: number;
    adr: number;
  }[];
  sabremetrics: DemoSabremetricStat[];
  round_history: RoundHistoryEntry[] | null;
}

export interface DemoIngestResult {
  matchId: number;
  generatedAt: string;
  /** Confirm-ready payload, or null when the score couldn't be derived (unknown side → gauntlet). */
  payload: DemoConfirmPayload | null;
  warnings: string[];
  quarantined: boolean;
  quarantineFlags: string[];
}
