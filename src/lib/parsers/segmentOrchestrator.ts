// The Buffer-consuming orchestration shared by parseDemoFileSegments() (demoParser.ts) and
// parseDemoSabremetricsSegments() (demoOrchestrator.ts): probe each segment's round range, derive
// offsets, run the real per-segment parse with the correct offset, check agreement, and merge.
// Kept separate from segmentMerge.ts, which is deliberately Buffer-free — this file is the one
// place that sequences Buffer-consuming work around those pure primitives, so the two callers
// can't drift on that sequencing.

import { getLiveRoundEndEvents } from './matchContext';
import { computeSegmentOffsets, checkSegmentAgreement, type SegmentRoundRange } from './segmentMerge';

/** The real, Buffer-consuming probe: a segment's own round range, cheaply, before the full
 *  per-segment parse. `orchestrateSegments()`'s default — overridable so the sequencing itself is
 *  testable with synthetic ranges, with no real demo buffer involved. */
export function probeSegmentRoundRange(buf: Buffer): SegmentRoundRange {
  const liveRounds = getLiveRoundEndEvents(buf);
  return {
    firstRoundNumber: liveRounds[0]?.total_rounds_played ?? 0,
    liveRoundCount: liveRounds.length,
  };
}

export function orchestrateSegments<TResult extends { warnings: string[] }>(
  demoBuffers: Buffer[],
  parseSegment: (buffer: Buffer, startingRealRound: number) => TResult,
  merge: (segments: TResult[]) => TResult,
  playerIdsOf: (segment: TResult) => number[],
  probeSegment: (buffer: Buffer) => SegmentRoundRange = probeSegmentRoundRange,
): TResult {
  const ranges: SegmentRoundRange[] = demoBuffers.map(probeSegment);
  const { order, startingRealRound } = computeSegmentOffsets(ranges);

  const segments = demoBuffers.map((buf, i) => parseSegment(buf, startingRealRound[i]));

  const agreement = checkSegmentAgreement({
    segments: ranges,
    order,
    playerIdsBySegment: segments.map(playerIdsOf),
  });

  const merged = merge(segments);
  return { ...merged, warnings: [...new Set([...agreement.flags, ...merged.warnings])] };
}
