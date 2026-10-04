// The one place that picks between the single-buffer and multi-segment parsers: more than one
// buffer means the match's demo was split across recordings by a server restart (docs/demo-ingestion.md's
// "Multi-segment demos"). Shared by `scripts/demo-ingest.ts`, `scripts/inspect-demo.ts`,
// `POST /api/matches/[id]/demo/parse`, and the real-demo corpus test, so none of them can drift from
// the others on how a demo is parsed.

import { parseDemoFile, parseDemoFileSegments, type RosterEntry, type ParsedDemoResult } from '../demoParser';
import { parseDemoSabremetrics, parseDemoSabremetricsSegments } from '../demoSabremetrics';
import type { ParsedDemoSabremetricsResult } from '../types';

export function parseDemoBuffers(
  demoBuffers: Buffer[],
  roster: RosterEntry[],
  skinsSide: 'CT' | 'T' | null,
  targetWinRounds: number,
): { parsed: ParsedDemoResult; sab: ParsedDemoSabremetricsResult } {
  const multi = demoBuffers.length > 1;
  return {
    parsed: multi
      ? parseDemoFileSegments(demoBuffers, roster, skinsSide, targetWinRounds)
      : parseDemoFile(demoBuffers[0], roster, skinsSide, targetWinRounds),
    sab: multi
      ? parseDemoSabremetricsSegments(demoBuffers, roster, skinsSide, targetWinRounds)
      : parseDemoSabremetrics(demoBuffers[0], roster, skinsSide, targetWinRounds),
  };
}
