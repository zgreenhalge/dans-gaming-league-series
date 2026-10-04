/**
 * Cross-collector invariants every clean parse of a real match must satisfy. Each check is a fact
 * about the *match* (its rounds, its score, its kills), not about any one collector's algorithm, so
 * a bug in any collector's round attribution shows up here even when that collector's own unit tests
 * pass. Returns human-readable violations; an empty array means the parse is consistent.
 */

import type { ParsedDemoResult } from '../demoParser';
import type { ParsedDemoSabremetricsResult } from '../types';

export interface ExpectedOutcome {
  shirts: number;
  skins: number;
  rounds: number;
}

export function checkDemoParseInvariants(
  parsed: ParsedDemoResult,
  sab: ParsedDemoSabremetricsResult,
  expected: ExpectedOutcome,
): string[] {
  const violations: string[] = [];

  for (const w of [...parsed.warnings, ...sab.warnings]) violations.push(`parser warning: ${w}`);

  if (parsed.shirts_score !== expected.shirts || parsed.skins_score !== expected.skins) {
    violations.push(
      `score ${parsed.shirts_score}-${parsed.skins_score}, expected ${expected.shirts}-${expected.skins}`,
    );
  }

  const history = parsed.round_history ?? [];
  if (history.length !== expected.rounds) {
    violations.push(`round_history has ${history.length} rounds, expected ${expected.rounds}`);
  }
  for (let i = 1; i < history.length; i++) {
    if (history[i].n !== history[i - 1].n + 1) {
      violations.push(`round_history is not contiguous at n=${history[i - 1].n} -> n=${history[i].n}`);
    }
  }

  const historyRounds = new Set(history.map((r) => r.n));
  const matchRoundNumbers = sab.matchRounds.map((r) => r.round_number);
  if (matchRoundNumbers.length !== historyRounds.size || matchRoundNumbers.some((n) => !historyRounds.has(n))) {
    violations.push('matchRounds do not cover exactly the rounds in round_history');
  }

  const seenVictims = new Set<string>();
  for (const k of sab.matchKills) {
    if (!historyRounds.has(k.round_number)) {
      violations.push(`match_kills row in round ${k.round_number}, which is not a live round`);
    }
    const key = `${k.round_number}:${k.victim_player_id}`;
    if (seenVictims.has(key)) {
      violations.push(`player ${k.victim_player_id} dies twice in round ${k.round_number}`);
    }
    seenVictims.add(key);
  }

  return violations;
}
