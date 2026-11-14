/**
 * Test-local fake for the `delete_upcoming_season` Postgres RPC
 * (`supabase/migrations/20261112120000_delete_upcoming_season.sql`) — see fakeSupabase.ts's own
 * header comment on why `.rpc()` has no generic in-memory equivalent and needs a per-name fake.
 * Mirrors the function's refusals as `FakeRpcError`s and, like the transaction, writes nothing when it
 * refuses.
 */

import { FakeRpcError, type RpcHandler } from './fakeSupabase';
import { deleteDraft, isMaterialized } from './seasonScheduleDraftRpc';

export const seasonDeleteRpcs: Record<string, RpcHandler> = {
  delete_upcoming_season: (args, db) => {
    const seasonId = args.p_season_id as number;
    const season = (db.seasons ?? []).find((s) => s.id === seasonId);
    if (!season) throw new FakeRpcError('season-not-found');
    if (season.status !== 'UPCOMING' || season.is_gauntlet) throw new FakeRpcError('season-not-upcoming');
    if (isMaterialized(db, seasonId)) throw new FakeRpcError('season-has-schedule');

    deleteDraft(db, seasonId);
    db.season_players = (db.season_players ?? []).filter((p) => p.season_id !== seasonId);
    db.seasons = (db.seasons ?? []).filter((s) => s.id !== seasonId);
    return null;
  },
};
