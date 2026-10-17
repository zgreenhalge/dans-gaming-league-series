/**
 * Cross-collector invariants every clean parse of a real match must satisfy. Each check is a fact
 * about the *match* (its rounds, its score, its kills), not about any one collector's algorithm, so
 * a bug in any collector's round attribution shows up here even when that collector's own unit tests
 * pass. Returns human-readable violations; an empty array means the parse is consistent.
 *
 * Two groups, split by what they need as input: `checkStructuralInvariants()` needs only the parse,
 * so it can run on any demo; `checkOutcomeInvariants()` also needs the match's confirmed score and
 * round count. `checkDemoParseInvariants()` runs both.
 */

import type { ParsedDemoResult } from '../demoParser';
import type { ParsedDemoSabremetricsResult } from '../types';

export interface ExpectedOutcome {
  shirts: number;
  skins: number;
  rounds: number;
}

export function checkOutcomeInvariants(parsed: ParsedDemoResult, expected: ExpectedOutcome): string[] {
  const violations: string[] = [];

  if (parsed.shirts_score !== expected.shirts || parsed.skins_score !== expected.skins) {
    violations.push(
      `score ${parsed.shirts_score}-${parsed.skins_score}, expected ${expected.shirts}-${expected.skins}`,
    );
  }

  const roundCount = (parsed.round_history ?? []).length;
  if (roundCount !== expected.rounds) {
    violations.push(`round_history has ${roundCount} rounds, expected ${expected.rounds}`);
  }

  return violations;
}

export function checkStructuralInvariants(
  parsed: ParsedDemoResult,
  sab: ParsedDemoSabremetricsResult,
): string[] {
  const violations: string[] = [];

  for (const w of [...parsed.warnings, ...sab.warnings]) violations.push(`parser warning: ${w}`);

  const history = parsed.round_history ?? [];
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

  const windowByRound = new Map(sab.roundWindows.map((w) => [w.round_number, w]));
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

    const window = windowByRound.get(k.round_number);
    if (!window) continue;
    if (window.freeze_end_tick !== null && k.tick < window.freeze_end_tick) {
      violations.push(
        `kill of player ${k.victim_player_id} at tick ${k.tick} is attributed to round ${k.round_number} ` +
          `but lands before that round's freeze time ends (tick ${window.freeze_end_tick})`,
      );
    }
    if (k.tick > window.settle_tick) {
      violations.push(
        `kill of player ${k.victim_player_id} at tick ${k.tick} is attributed to round ${k.round_number} ` +
          `but lands after that round has settled (tick ${window.settle_tick})`,
      );
    }
  }

  return violations;
}

export function checkDemoParseInvariants(
  parsed: ParsedDemoResult,
  sab: ParsedDemoSabremetricsResult,
  expected: ExpectedOutcome,
): string[] {
  return [...checkStructuralInvariants(parsed, sab), ...checkOutcomeInvariants(parsed, expected)];
}
