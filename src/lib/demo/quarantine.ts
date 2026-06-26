// Messy-demo heuristics for the demo-ingestion pipeline (Phase 3 of the DatHost + MatchZy
// initiative — see dathost_handoff/DATHOST_PHASE0_PLAN.md). A demo that trips any check is
// *quarantined* (flagged, not auto-processed) so a human handles it via the existing manual flow.
//
// These are pure, deterministic functions over a parsed demo's round outcomes — no I/O — so they're
// cheap to unit-test and safe to call from either the in-app parse path or the Action job.
//
// The strongest backup/restore detection needs the *raw* round_end markers (round number + tick),
// which a backup/restore (`.stop` / `loadbackup`) makes non-monotonic or duplicated. The parser's
// `round_history` is already cleaned/renumbered, so when only `round_history` is available the
// sequence checks are weak and the count checks carry the weight. Pass `rawRounds` when the caller
// has the raw round_end events for the full check.

import type { RoundHistoryEntry } from '../types';

export interface QuarantineInput {
  /** Parser output (`ParsedDemoResult.round_history`); cleaned/renumbered. */
  roundHistory: RoundHistoryEntry[] | null;
  /** Derived final score (rounds won). Null when the side was unknown at parse time. */
  shirtsScore: number | null;
  skinsScore: number | null;
  /** `seasons.target_win_rounds ?? 13`. */
  targetWinRounds: number;
  /** Optional raw round_end markers (round number + end tick), in capture order. When present these
   *  drive the regression/duplicate checks (a backup/restore shows up here, not in round_history). */
  rawRounds?: { n: number; tick: number }[];
}

export interface QuarantineResult {
  ok: boolean;
  /** Human-readable reasons; empty when `ok`. Surfaced on the admin/ingestion page. */
  flags: string[];
}

/** Decide whether a parsed demo should be quarantined rather than auto-processed. */
export function quarantineDemo(input: QuarantineInput): QuarantineResult {
  const { roundHistory, shirtsScore, skinsScore, targetWinRounds } = input;
  const flags: string[] = [];

  // Sequence markers: prefer raw round_end (n + tick), else fall back to round_history (n only).
  const markers: { n: number; tick?: number }[] =
    input.rawRounds ?? (roundHistory ?? []).map((r) => ({ n: r.n }));

  // 1. Round-number regression — a later round has a number <= an earlier one.
  for (let i = 1; i < markers.length; i++) {
    if (markers[i].n <= markers[i - 1].n) {
      flags.push(
        `round number did not increase (…${markers[i - 1].n} → ${markers[i].n} at position ${i}) — possible backup/restore replay`,
      );
      break;
    }
  }

  // 2. Duplicate round numbers — the same round appears twice (replayed round).
  const seenN = new Set<number>();
  for (const m of markers) {
    if (seenN.has(m.n)) {
      flags.push(`duplicate round number ${m.n} — possible replayed round`);
      break;
    }
    seenN.add(m.n);
  }

  // 3. Duplicate end ticks — only meaningful when raw ticks are present.
  if (markers.length > 0 && markers[0].tick !== undefined) {
    const seenT = new Set<number>();
    for (const m of markers) {
      if (m.tick === undefined) continue;
      if (seenT.has(m.tick)) {
        flags.push(`duplicate round-end tick ${m.tick} — possible replayed round`);
        break;
      }
      seenT.add(m.tick);
    }
  }

  // 4. Round count vs target — incomplete/abandoned, or history/score disagreement.
  if (shirtsScore !== null && skinsScore !== null) {
    const maxWins = Math.max(shirtsScore, skinsScore);
    const total = shirtsScore + skinsScore;

    // A completed regulation match has the winner on exactly targetWinRounds; overtime pushes the
    // winner above it. Below it ⇒ nobody closed out ⇒ incomplete/abandoned.
    if (maxWins < targetWinRounds) {
      flags.push(
        `no side reached ${targetWinRounds} rounds (max ${maxWins}) — match may be incomplete or abandoned`,
      );
    }

    // round_history should account for exactly the rounds in the score.
    if (roundHistory && roundHistory.length > 0 && roundHistory.length !== total) {
      flags.push(`round_history has ${roundHistory.length} rounds but the score totals ${total}`);
    }
  }

  return { ok: flags.length === 0, flags };
}
