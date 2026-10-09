/**
 * Test-local fakes for the `replace_superlative_votes` (`20261009160000_add_feedback_player_save_rpcs.sql`) and
 * `reorder_superlatives` Postgres RPCs (`supabase/migrations/20261008160000_add_superlative_atomic_rpcs.sql`) and `reset_superlative_votes`
 * (`supabase/migrations/20261008170000_add_feedback_atomic_rpcs.sql`) — see fakeSupabase.ts's own
 * header comment on why `.rpc()` has no generic in-memory equivalent and needs a per-name fake.
 * Shared by every test that drives a superlatives route far enough to reach one of these calls.
 */

import { nextId, type RpcHandler } from './fakeSupabase';

type RpcVote = { superlative_id: number; nominee_player_id: number };

export const superlativeRpcs: Record<string, RpcHandler> = {
  replace_superlative_votes: (args, db) => {
    const poll = (db.superlative_polls ?? []).find((p) => p.season_id === args.p_season_id);
    if (!poll || !poll.is_open) return false;
    const voter = args.p_voter_player_id as number;
    const ids = args.p_superlative_ids as number[];
    const votes = args.p_votes as RpcVote[];
    db.superlative_votes = (db.superlative_votes ?? []).filter((r) => !(r.voter_player_id === voter && ids.includes(r.superlative_id as number)));
    for (const v of votes) {
      if (!ids.includes(v.superlative_id)) continue;
      db.superlative_votes.push({
        id: nextId(db.superlative_votes), superlative_id: v.superlative_id, voter_player_id: voter, nominee_player_id: v.nominee_player_id,
      });
    }
    return true;
  },
  reorder_superlatives: (args, db) => {
    const seasonId = args.p_season_id as number;
    const order = args.p_order as number[];
    for (const row of db.superlatives ?? []) {
      const index = order.indexOf(row.id as number);
      if (row.season_id === seasonId && index >= 0) row.position = index + 1;
    }
    return null;
  },
  reset_superlative_votes: (args, db) => {
    const seasonId = args.p_season_id as number;
    for (const poll of db.superlative_polls ?? []) if (poll.season_id === seasonId) poll.is_open = false;
    const ids = new Set((db.superlatives ?? []).filter((s) => s.season_id === seasonId).map((s) => s.id));
    db.superlative_votes = (db.superlative_votes ?? []).filter((v) => !ids.has(v.superlative_id));
    return null;
  },
};
