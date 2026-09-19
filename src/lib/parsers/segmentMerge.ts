// Pure, Buffer-free primitives for combining multiple independently-parsed demo segments (e.g. two
// GOTV recordings split by a mid-match server restart) into one result. Nothing here touches a
// Buffer or calls into demoparser2 — every function operates on the *output* of parseSegment-shaped
// parsing, keyed by round_number/player_id, so a future change to a collector never requires a
// matching change here: this merges by generic shape (sum the numeric fields sharing a key, or
// concatenate the fact rows), not by any specific field name.
//
// See src/lib/parsers/roundSides.ts's `startingRealRound` param for the companion half of this: the
// round-anchoring fix that makes each segment's own numbers correct in the first place. Merging
// segments whose round anchoring is still segment-relative would combine wrong numbers correctly.

import type { DemoPlayerStat, ParsedDemoResult } from '../demoParser';
import type {
  ParsedDemoSabremetricsResult, DemoSabremetricStat, DemoWeaponStat, WeaponStatFields, SabFields,
} from '../types';

/**
 * Groups `rows` by the string value of `keyFields` and sums every other numeric field across the
 * group, taking the first-seen value for non-numeric fields. Generic over shape — adding a new
 * numeric field to whatever produced `rows` (e.g. a new `SabFields` collector) is summed
 * automatically, with no change needed here.
 */
export function sumNumericFields<T extends object>(
  rows: T[],
  keyFields: (keyof T)[],
): T[] {
  const asRecord = (row: T) => row as unknown as Record<string, unknown>;

  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFields.map((k) => String(asRecord(row)[k as string])).join('\u0000');
    const group = groups.get(key);
    if (group) group.push(row); else groups.set(key, [row]);
  }

  // Map preserves insertion order, so this stays in first-appearance order with no separate array.
  return [...groups.values()].map((group) => {
    const merged = asRecord({ ...group[0] });
    const allFields = new Set<string>();
    for (const row of group) for (const field of Object.keys(row as object)) allFields.add(field);

    for (const field of allFields) {
      if ((keyFields as string[]).includes(field)) continue;
      // Checked across the whole group, not just group[0] — a field a later row has but the
      // first-seen row lacks must still be summed in, not silently dropped.
      const isNumeric = group.some((r) => typeof asRecord(r)[field] === 'number');
      if (isNumeric) {
        merged[field] = group.reduce((sum, r) => sum + ((asRecord(r)[field] as number) ?? 0), 0);
      }
    }
    return merged as T;
  });
}

export interface SegmentRoundRange {
  /** `total_rounds_played` of this segment's own first live round. */
  firstRoundNumber: number;
  /** Count of live rounds this segment contributes. */
  liveRoundCount: number;
}

/**
 * Sorts segments by their own first live round — robust against upload/argument order, since
 * nothing about which file an admin attaches first guarantees it's chronologically first — and
 * derives each one's match-wide `startingRealRound` for `buildRoundSides()`/`buildMatchContext()`,
 * in the *original* input order so a caller can zip the result back against its own segment array
 * by index.
 */
export function computeSegmentOffsets(
  segments: SegmentRoundRange[],
): { order: number[]; startingRealRound: number[] } {
  const order = segments
    .map((_, i) => i)
    .sort((a, b) => segments[a].firstRoundNumber - segments[b].firstRoundNumber);

  const startingRealRound = new Array<number>(segments.length);
  let nextStart = 1;
  for (const i of order) {
    startingRealRound[i] = nextStart;
    nextStart += segments[i].liveRoundCount;
  }
  return { order, startingRealRound };
}

export interface SegmentAgreementInput {
  /** Original (unsorted) order — same array `computeSegmentOffsets` was given. */
  segments: SegmentRoundRange[];
  /** From `computeSegmentOffsets` (or recomputed the same way). */
  order: number[];
  /** Resolved roster player_ids per segment, in the same original order as `segments`. */
  playerIdsBySegment: number[][];
}

/**
 * Guards against a bad segment pairing before trusting a merge: flags a gap or overlap in round
 * coverage across segment boundaries, and any segment that resolved a different roster than the
 * others — either is a strong signal of a wrong file/match pairing, not something to merge past.
 *
 * The gap/overlap check assumes `total_rounds_played` numbering carries over seamlessly between
 * segments (the round-backup-restore case this module is built for preserves round history across
 * the restart, even though it resets per-player accumulators — see `mergeSegmentResults`'s doc). A
 * pairing where the round counter itself reset reads as an overlap here and gets flagged rather
 * than silently merged with wrong numbers.
 */
export function checkSegmentAgreement(input: SegmentAgreementInput): { ok: boolean; flags: string[] } {
  const { segments, order, playerIdsBySegment } = input;
  const flags: string[] = [];

  for (let i = 1; i < order.length; i++) {
    const prev = segments[order[i - 1]];
    const cur = segments[order[i]];
    const expectedNext = prev.firstRoundNumber + prev.liveRoundCount;
    if (cur.firstRoundNumber > expectedNext) {
      flags.push(
        `gap in round coverage between segments: expected round ${expectedNext}, next segment starts at ${cur.firstRoundNumber}`,
      );
    } else if (cur.firstRoundNumber < expectedNext) {
      flags.push(
        `overlap in round coverage between segments: expected round ${expectedNext}, next segment starts at ${cur.firstRoundNumber}`,
      );
    }
  }

  if (order.length > 1) {
    const referenceIdx = order[0];
    const reference = new Set(playerIdsBySegment[referenceIdx]);
    for (const i of order.slice(1)) {
      const ids = new Set(playerIdsBySegment[i]);
      const sameSize = ids.size === reference.size;
      const sameMembers = sameSize && [...reference].every((id) => ids.has(id));
      if (!sameMembers) {
        flags.push(
          `roster mismatch: segment resolved player_ids [${[...ids].join(', ')}], expected [${[...reference].join(', ')}]`,
        );
      }
    }
  }

  return { ok: flags.length === 0, flags };
}

/** Combines each segment's `ParsedDemoResult` (parseDemoFile's shape) into one. Raw per-player
 *  counters (kills/deaths/assists/damage/rounds_played/rounds_won) are additive once each segment's
 *  own round anchoring is correct; ADR and is_win are *derived*, so they're recomputed from the
 *  merged totals rather than summed or overwritten by the last segment.
 *
 *  This additivity assumes each segment's counters reflect only that segment's own rounds — true
 *  for a server-process restart (each segment is a fresh engine session with its own accumulators
 *  starting at zero), not for a recording-only interruption where the underlying game session, and
 *  so its accumulators, survive across the split. `checkSegmentAgreement()` is the guard against
 *  merging a pairing where that assumption doesn't hold: a session that never actually reset
 *  produces round numbering that reads as an overlap, not a clean contiguous handoff. */
export function mergeSegmentResults(segments: ParsedDemoResult[]): ParsedDemoResult {
  const warnings = [...new Set(segments.flatMap((s) => s.warnings))];

  const allScoresKnown = segments.every((s) => s.shirts_score !== null && s.skins_score !== null);
  const sumScore = (pick: (s: ParsedDemoResult) => number | null) =>
    allScoresKnown ? segments.reduce((sum, s) => sum + pick(s)!, 0) : null;
  const shirts_score = sumScore((s) => s.shirts_score);
  const skins_score = sumScore((s) => s.skins_score);

  const round_history = segments.every((s) => s.round_history)
    ? segments.flatMap((s) => s.round_history!).sort((a, b) => a.n - b.n)
    : null;

  // sumNumericFields also sums `adr` (it's numeric) into a meaningless total; discarded below in
  // favor of recomputing it from the merged damage/rounds_played, the only correct way to combine
  // a derived rate rather than a raw counter.
  const summedStats = sumNumericFields(segments.flatMap((s) => s.stats), ['player_id', 'faction']);
  const stats: DemoPlayerStat[] = summedStats.map((s) => {
    const adr = s.rounds_played > 0 ? Math.round(s.damage / s.rounds_played) : 0;
    const is_win =
      allScoresKnown &&
      (s.faction === 'SHIRTS' ? shirts_score! > skins_score! : skins_score! > shirts_score!);
    return { ...s, adr, is_win };
  });

  // Segments should agree on the demo-inferred starting side (it's a property of the one match,
  // not of any single recording) — surfacing a disagreement rather than silently picking whichever
  // segment happens to come first is the same "never substitute a plausible-looking wrong value"
  // rule the rest of this module follows for scores.
  const distinctInferredSides = [
    ...new Set(segments.map((s) => s.inferred_side).filter((s): s is 'CT' | 'T' => s !== null)),
  ];
  const inferred_side = distinctInferredSides.length === 1 ? distinctInferredSides[0] : null;
  if (distinctInferredSides.length > 1) {
    warnings.push(
      `Segments disagree on the demo-inferred starting side (${distinctInferredSides.join(', ')}) — verify these demos belong to the same match.`,
    );
  }

  return { stats, shirts_score, skins_score, round_history, warnings, inferred_side };
}

/** Combines each segment's `weaponStats`/`economyStats` bucket arrays (WeaponStatFields keyed by
 *  `weapon`/`economy_type`) additively per player, per bucket — same shape either table uses. */
function mergeBuckets<K extends string>(
  perSegment: { player_id: number; buckets: (WeaponStatFields & Record<K, string>)[] }[],
  bucketKey: K,
): Map<number, (WeaponStatFields & Record<K, string>)[]> {
  const flat = perSegment.flatMap((s) =>
    s.buckets.map((b) => ({ player_id: s.player_id, ...b })),
  );
  const summed = sumNumericFields(flat, ['player_id', bucketKey]);
  const byPlayer = new Map<number, (WeaponStatFields & Record<K, string>)[]>();
  for (const row of summed) {
    const { player_id, ...bucket } = row;
    const list = byPlayer.get(player_id) ?? [];
    list.push(bucket as WeaponStatFields & Record<K, string>);
    byPlayer.set(player_id, list);
  }
  return byPlayer;
}

/** Combines each segment's `ParsedDemoSabremetricsResult` (parseDemoSabremetrics's shape) into one.
 *  `SabFields` sum generically per player (any future field included, no hardcoded list); weapon/
 *  economy buckets sum per (player, bucket); every fact-row array concatenates untouched, since
 *  `round_number` is already globally comparable across segments (see roundSides.ts). */
export function mergeSabremetricResults(
  segments: ParsedDemoSabremetricsResult[],
): ParsedDemoSabremetricsResult {
  const warnings = [...new Set(segments.flatMap((s) => s.warnings))];

  const flatSab = segments.flatMap((s) =>
    s.sabremetrics.map((r) => ({ player_id: r.player_id, ...r.sabremetrics })),
  );
  const mergedSab = sumNumericFields(flatSab, ['player_id']);
  const sabremetrics: DemoSabremetricStat[] = mergedSab.map((row) => {
    const { player_id, ...sabremetrics } = row;
    return { player_id, sabremetrics: sabremetrics as SabFields };
  });

  const bucketsOf = <B extends WeaponStatFields>(pick: (w: DemoWeaponStat) => B[]) =>
    segments.flatMap((s) => s.weaponStats.map((w) => ({ player_id: w.player_id, buckets: pick(w) })));

  const weaponByPlayer = mergeBuckets(bucketsOf((w) => w.weaponStats), 'weapon');
  const economyByPlayer = mergeBuckets(bucketsOf((w) => w.economyStats), 'economy_type');
  const playerIds = new Set([...weaponByPlayer.keys(), ...economyByPlayer.keys()]);
  const weaponStats: DemoWeaponStat[] = [...playerIds].map((player_id) => ({
    player_id,
    weaponStats: weaponByPlayer.get(player_id) ?? [],
    economyStats: economyByPlayer.get(player_id) ?? [],
  }));

  return {
    sabremetrics,
    weaponStats,
    matchKills: segments.flatMap((s) => s.matchKills),
    matchRounds: segments.flatMap((s) => s.matchRounds),
    matchUtilityThrows: segments.flatMap((s) => s.matchUtilityThrows),
    matchRoundEconomy: segments.flatMap((s) => s.matchRoundEconomy),
    matchDamageEvents: segments.flatMap((s) => s.matchDamageEvents),
    warnings,
  };
}
