// The one place that picks between the single-buffer and multi-segment parsers: more than one
// buffer means the match's demo was split across recordings by a server restart (docs/demo-ingestion.md's
// "Multi-segment demos"). Shared by `scripts/demo-ingest.ts`, `scripts/inspect-demo.ts`,
// `POST /api/matches/[id]/demo/parse`, and the real-demo corpus test, so none of them can drift from
// the others on how a demo is parsed.

import { parseDemoFile, parseDemoFileSegments, type RosterEntry, type ParsedDemoResult } from '../demoParser';
import { roundedAdr } from '../util';
import { parseDemoSabremetrics, parseDemoSabremetricsSegments } from '../demoSabremetrics';
import type { ParsedDemoSabremetricsResult } from '../types';

/**
 * Replaces each player's `damage` (and the ADR derived from it) with their enemy-only total from the
 * damage fact rows (`damage_ct + damage_t`). The engine's `m_iDamage` also credits damage to
 * breakable props, which never appear as a `player_hurt` event, so it overstates what a player did
 * to other players. Left as parsed when sabremetrics couldn't attribute rounds (starting side
 * unknown), since no event-derived total exists then.
 */
export function withEnemyDamage(
  parsed: ParsedDemoResult,
  sab: ParsedDemoSabremetricsResult,
): ParsedDemoResult {
  if (sab.sabremetrics.length === 0) return parsed;
  const damageByPlayer = new Map(
    sab.sabremetrics.map((s) => [s.player_id, s.sabremetrics.damage_ct + s.sabremetrics.damage_t]),
  );
  return {
    ...parsed,
    stats: parsed.stats.map((p) => {
      const damage = damageByPlayer.get(p.player_id) ?? 0;
      return { ...p, damage, adr: roundedAdr(damage, p.rounds_played) };
    }),
  };
}

export function parseDemoBuffers(
  demoBuffers: Buffer[],
  roster: RosterEntry[],
  skinsSide: 'CT' | 'T' | null,
  targetWinRounds: number,
): { parsed: ParsedDemoResult; sab: ParsedDemoSabremetricsResult } {
  const multi = demoBuffers.length > 1;
  const parsed = multi
    ? parseDemoFileSegments(demoBuffers, roster, skinsSide, targetWinRounds)
    : parseDemoFile(demoBuffers[0], roster, skinsSide, targetWinRounds);
  const sab = multi
    ? parseDemoSabremetricsSegments(demoBuffers, roster, skinsSide, targetWinRounds)
    : parseDemoSabremetrics(demoBuffers[0], roster, skinsSide, targetWinRounds);
  return { parsed: withEnemyDamage(parsed, sab), sab };
}
