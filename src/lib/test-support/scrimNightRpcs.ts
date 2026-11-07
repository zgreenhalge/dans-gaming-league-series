/**
 * Test-local fakes for the `start_scrim_night` / `leave_scrim_night` Postgres RPCs
 * (`supabase/migrations/20261107160000_scrim_night_overlap_by_end.sql`) — see fakeSupabase.ts's
 * header on why `.rpc()` needs a per-name fake. Mirrors each function's refusals as `FakeRpcError`s.
 */

import { scrimNightEnd } from '../scrim-schedule';
import { FakeRpcError, nextId, type Row, type RpcHandler } from './fakeSupabase';

export const scrimNightRpcs: Record<string, RpcHandler> = {
  start_scrim_night: (args, db) => {
    const start = Date.parse(args.p_starts_at as string);
    const length = (args.p_night_minutes as number) * 60_000;
    db.scrim_nights ??= [];
    db.scrim_signups ??= [];
    const overlaps = (n: Row) =>
      Date.parse(n.starts_at as string) < start + length &&
      scrimNightEnd({ id: n.id as number, startsAt: n.starts_at as string, endedAt: n.ended_at as string | null }) > start;
    if (db.scrim_nights.some(overlaps)) {
      throw new FakeRpcError('overlapping-scrim-night');
    }
    const id = nextId(db.scrim_nights);
    db.scrim_nights.push({ id, starts_at: args.p_starts_at, ended_at: null });
    db.scrim_signups.push({
      id: nextId(db.scrim_signups),
      night_id: id,
      player_id: args.p_player_id,
      commitment: args.p_commitment,
      signed_up_at: new Date().toISOString(),
      checked_in_at: null,
    });
    return id;
  },
  leave_scrim_night: (args, db) => {
    const nightId = args.p_night_id as number;
    if (!(db.scrim_nights ?? []).some((n) => n.id === nightId)) throw new FakeRpcError(`Scrim night ${nightId} not found`);
    db.scrim_signups = (db.scrim_signups ?? []).filter((s) => !(s.night_id === nightId && s.player_id === args.p_player_id));
    if (db.scrim_signups.some((s) => s.night_id === nightId) || (db.matches ?? []).some((m) => m.scrim_night_id === nightId)) return false;
    db.scrim_nights = db.scrim_nights.filter((n) => n.id !== nightId);
    return true;
  },
};
