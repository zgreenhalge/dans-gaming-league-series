// Trusted auto-commit predicate (D5, issue #138) — pure decision logic, no I/O. Kept separate from
// the demo-ingest Action (which gathers the inputs and performs the write) so the rule is
// independently readable and testable, mirroring `quarantine.ts`'s split between decision and caller.

export interface AutoCommitInput {
  /** `quarantineDemo()`'s verdict. */
  quarantinePassed: boolean;
  /** Combined parser warning count (parseDemoFile + parseDemoSabremetrics). */
  warningCount: number;
  /** `skins_starting_side` was STORED, not just demo-inferred — excludes the gauntlet knife path
   *  (#137's self-derived score always has a payload, but never a stored side). */
  skinsSideStored: boolean;
  /** The match already has a confirmed score. Auto-commit never overwrites a played match — a
   *  disagreement always routes to manual review, regardless of how clean the new parse is. */
  alreadyPlayed: boolean;
  /** The demo-derived score. */
  derived: { shirts: number; skins: number };
  /** MatchZy's own `map_result` event, or null when it hasn't landed in R2 yet. */
  mapResult: { shirts: number; skins: number } | null;
}

export type AutoCommitDecision = { eligible: true } | { eligible: false; reason: string };

/** Evaluate the D5 predicate. `eligible` means every check passed — the caller still gates the
 *  actual write on `AUTO_COMMIT_ENABLED` (shadow mode evaluates + logs without writing). */
export function evaluateAutoCommit(input: AutoCommitInput): AutoCommitDecision {
  if (input.alreadyPlayed) {
    return { eligible: false, reason: 'match already has a confirmed score — auto-commit never overwrites a played match' };
  }
  if (!input.quarantinePassed) {
    return { eligible: false, reason: 'quarantined' };
  }
  if (input.warningCount > 0) {
    return { eligible: false, reason: `${input.warningCount} parser warning(s)` };
  }
  if (!input.skinsSideStored) {
    return { eligible: false, reason: 'skins_starting_side not stored (demo-inferred only)' };
  }
  if (!input.mapResult) {
    return { eligible: false, reason: 'no map_result received' };
  }
  if (input.mapResult.shirts !== input.derived.shirts || input.mapResult.skins !== input.derived.skins) {
    return {
      eligible: false,
      reason: `demo score ${input.derived.shirts}-${input.derived.skins} disagrees with map_result ${input.mapResult.shirts}-${input.mapResult.skins}`,
    };
  }
  return { eligible: true };
}
