/**
 * Test-local fake for the `set_season_buy_in` Postgres RPC
 * (`supabase/migrations/20261008180000_add_set_season_buy_in_rpc.sql`) — see fakeSupabase.ts's own
 * header comment on why `.rpc()` has no generic in-memory equivalent and needs a per-name fake.
 * Returns the same `{ status }` the real function does and writes only on `ok`.
 */

import type { RpcHandler } from './fakeSupabase';
import { draftWeeksOf, isMaterialized } from './seasonScheduleDraftRpc';

export const seasonBuyInRpcs: Record<string, RpcHandler> = {
  set_season_buy_in: (args, db) => {
    const seasonId = args.p_season_id as number;
    const season = (db.seasons ?? []).find((s) => s.id === seasonId);
    if (!season || season.is_gauntlet) return { status: 'not-found' };
    if (season.status !== 'UPCOMING') return { status: 'not-upcoming' };
    if (draftWeeksOf(db, seasonId).length > 0 || isMaterialized(db, seasonId)) return { status: 'schedule-generated' };
    season.buy_in_amount = args.p_amount;
    return { status: 'ok' };
  },
};
