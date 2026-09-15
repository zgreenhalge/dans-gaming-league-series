import type { BracketPod } from '@/lib/queries';

/** A single, fully-shaped `BracketPod` for pure-function and component tests that need a pod to
 * feed in but don't care about most of its fields — override only what a given test cares about. */
export function bracketPod(overrides: Partial<BracketPod> & { id: number }): BracketPod {
  return {
    round_number: 1,
    pod_index: 0,
    advance_rule: 'wildcard',
    is_final: false,
    played: false,
    materialized: false,
    slots: [],
    ...overrides,
  };
}
