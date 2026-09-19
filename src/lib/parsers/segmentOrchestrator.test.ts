/**
 * Unit tests for orchestrateSegments() — the sequencing glue (probe → offsets → per-segment parse
 * → agreement → merge) shared by parseDemoFileSegments()/parseDemoSabremetricsSegments(). The
 * per-segment parse/merge/probe steps are all injected here as fakes, so this proves the
 * *sequencing* itself is correct with no real demo buffer or demoparser2 call involved — the thing
 * this module's own header comment says is the one place that sequencing lives, and previously had
 * no direct test (only the pure helpers underneath it did).
 *
 * Run:  npx vitest run src/lib/parsers/segmentOrchestrator.test.ts
 */

import assert from 'node:assert/strict';
import { orchestrateSegments } from './segmentOrchestrator';
import type { SegmentRoundRange } from './segmentMerge';
import { test, report } from '../test-support/miniTest';

interface FakeResult {
  label: string;
  startingRealRound: number;
  warnings: string[];
}

function fakeBuffers(n: number): Buffer[] {
  return Array.from({ length: n }, () => Buffer.alloc(0));
}

test('orchestrateSegments: a single segment gets startingRealRound 1 and no agreement flags', () => {
  const seenOffsets: number[] = [];
  const result = orchestrateSegments<FakeResult>(
    fakeBuffers(1),
    (_buf, startingRealRound) => {
      seenOffsets.push(startingRealRound);
      return { label: 'a', startingRealRound, warnings: [] };
    },
    (segments) => ({ label: segments.map((s) => s.label).join(','), startingRealRound: 0, warnings: [] }),
    () => [1, 2, 3, 4],
    () => ({ firstRoundNumber: 1, liveRoundCount: 10 }),
  );
  assert.deepEqual(seenOffsets, [1]);
  assert.equal(result.label, 'a');
  assert.deepEqual(result.warnings, []);
});

test('orchestrateSegments: two segments in order get offsets derived from their probed ranges', () => {
  const ranges: SegmentRoundRange[] = [
    { firstRoundNumber: 1, liveRoundCount: 4 },
    { firstRoundNumber: 5, liveRoundCount: 19 },
  ];
  let probeCall = 0;
  const seenOffsets: number[] = [];
  const result = orchestrateSegments<FakeResult>(
    fakeBuffers(2),
    (_buf, startingRealRound) => {
      seenOffsets.push(startingRealRound);
      return { label: 'seg', startingRealRound, warnings: [] };
    },
    (segments) => ({
      label: 'merged',
      startingRealRound: segments.reduce((sum, s) => sum + s.startingRealRound, 0),
      warnings: [],
    }),
    () => [1, 2, 3, 4],
    () => ranges[probeCall++],
  );
  assert.deepEqual(seenOffsets, [1, 5]);
  assert.equal(result.startingRealRound, 6);
});

test('orchestrateSegments: segments probed out of chronological order still get their own correct offset, matched by buffer index not sort position', () => {
  // Buffer 0 is probed as the LATER segment (starts at round 5); buffer 1 as the earlier one.
  // parseSegment must still be called in original buffer order (0 then 1), each with the offset
  // that actually belongs to it, not the offset of whatever ends up sorted first.
  const ranges: SegmentRoundRange[] = [
    { firstRoundNumber: 5, liveRoundCount: 19 }, // buffer 0
    { firstRoundNumber: 1, liveRoundCount: 4 },  // buffer 1
  ];
  let probeCall = 0;
  const seenOffsets: number[] = [];
  orchestrateSegments<FakeResult>(
    fakeBuffers(2),
    (_buf, startingRealRound) => {
      seenOffsets.push(startingRealRound);
      return { label: 'seg', startingRealRound, warnings: [] };
    },
    (segments) => segments[0],
    () => [1],
    () => ranges[probeCall++],
  );
  assert.deepEqual(seenOffsets, [5, 1]);
});

test("orchestrateSegments: agreement flags fold into the merged warnings, deduped against the merge result's own", () => {
  const ranges: SegmentRoundRange[] = [
    { firstRoundNumber: 1, liveRoundCount: 4 },
    { firstRoundNumber: 6, liveRoundCount: 19 }, // gap: round 5 missing
  ];
  let probeCall = 0;
  const result = orchestrateSegments<FakeResult>(
    fakeBuffers(2),
    () => ({ label: 'seg', startingRealRound: 0, warnings: ['pre-existing warning'] }),
    () => ({ label: 'merged', startingRealRound: 0, warnings: ['pre-existing warning'] }),
    () => [1, 2, 3, 4],
    () => ranges[probeCall++],
  );
  assert.equal(result.warnings.filter((w) => w === 'pre-existing warning').length, 1);
  assert.ok(result.warnings.some((w) => /gap/i.test(w)), result.warnings.join('; '));
});

test('orchestrateSegments: playerIdsOf is applied per parsed segment and feeds the roster-agreement check', () => {
  const ranges: SegmentRoundRange[] = [
    { firstRoundNumber: 1, liveRoundCount: 4 },
    { firstRoundNumber: 5, liveRoundCount: 19 },
  ];
  const idsPerSegment = [[1, 2, 3, 4], [1, 2, 3, 99]];
  let probeCall = 0;
  let idsCall = 0;
  const result = orchestrateSegments<FakeResult>(
    fakeBuffers(2),
    () => ({ label: 'seg', startingRealRound: 0, warnings: [] }),
    () => ({ label: 'merged', startingRealRound: 0, warnings: [] }),
    () => idsPerSegment[idsCall++],
    () => ranges[probeCall++],
  );
  assert.ok(result.warnings.some((w) => /roster mismatch/i.test(w)), result.warnings.join('; '));
});

report();
