// Pure logic for the superlatives vote — title, order and ballot validation, and vote tallying. No
// IO, so the routes, queries, and tests all share it. The survey's rules are in `survey.ts`; the
// rules both forms share are in `feedback-rules.ts`.

import type { Validated } from './feedback-rules';

export const MAX_SUPERLATIVE_TITLE_LENGTH = 80;

/** Validates a superlative title typed by an admin. */
export function validateSuperlativeTitle(input: unknown): Validated<string> {
  const title = typeof input === 'string' ? input.trim() : '';
  if (!title) return { ok: false, error: 'title is required' };
  if (title.length > MAX_SUPERLATIVE_TITLE_LENGTH) {
    return { ok: false, error: `Titles are limited to ${MAX_SUPERLATIVE_TITLE_LENGTH} characters` };
  }
  return { ok: true, value: title };
}

/** Validates a new superlative order (`{ order: [id, …] }`): it must list every one of the season's
 *  superlative ids exactly once. */
export function validateSuperlativeOrder(currentIds: number[], input: unknown): Validated<number[]> {
  if (!Array.isArray(input) || input.some((id) => typeof id !== 'number')) {
    return { ok: false, error: 'order must be an array of superlative ids' };
  }
  const ids = input as number[];
  const current = new Set(currentIds);
  if (ids.length !== current.size || new Set(ids).size !== ids.length || ids.some((id) => !current.has(id))) {
    return { ok: false, error: 'order must list every superlative exactly once' };
  }
  return { ok: true, value: ids };
}

// A `type` (not an interface) so it is assignable to `Json` as an RPC argument.
export type SuperlativeVoteInput = {
  superlative_id: number;
  nominee_player_id: number;
};

/** Validates a ballot (`{ votes: [{ superlative_id, nominee_player_id }] }`) against the season's
 *  superlatives and the players who may be nominated. A ballot may skip superlatives, but names at
 *  most one nominee per superlative. */
export function validateSuperlativeVotes(
  superlativeIds: number[],
  nomineeIds: number[],
  input: unknown,
): Validated<SuperlativeVoteInput[]> {
  if (!Array.isArray(input)) return { ok: false, error: 'votes must be an array' };
  const validSuperlatives = new Set(superlativeIds);
  const validNominees = new Set(nomineeIds);
  const seen = new Set<number>();
  const votes: SuperlativeVoteInput[] = [];
  for (const raw of input) {
    const v = raw as { superlative_id?: unknown; nominee_player_id?: unknown } | null;
    // Ids must arrive as numbers — `Number()` would turn `true`, `null`, or `[1]` into a real id.
    const superlativeId = v?.superlative_id;
    const nomineeId = v?.nominee_player_id;
    if (typeof superlativeId !== 'number' || !validSuperlatives.has(superlativeId)) return { ok: false, error: 'Unknown superlative' };
    if (typeof nomineeId !== 'number' || !validNominees.has(nomineeId)) return { ok: false, error: 'Nominee did not play this season' };
    if (seen.has(superlativeId)) return { ok: false, error: 'One vote per superlative' };
    seen.add(superlativeId);
    votes.push({ superlative_id: superlativeId, nominee_player_id: nomineeId });
  }
  return { ok: true, value: votes };
}

export interface NomineeTally {
  player_id: number;
  votes: number;
}

/** Vote counts per nominee, most votes first (ties by player id so the order is stable). */
export function tallyVotes(nomineeIds: number[]): NomineeTally[] {
  const counts = new Map<number, number>();
  for (const id of nomineeIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()]
    .map(([player_id, votes]) => ({ player_id, votes }))
    .sort((a, b) => b.votes - a.votes || a.player_id - b.player_id);
}
