/**
 * Test-local fakes for the `start_scrim_night` / `reopen_scrim_night` / `leave_scrim_night` Postgres
 * RPCs (`supabase/migrations/20261110120000_scrim_night_idle_end.sql`) — see fakeSupabase.ts's header
 * on why `.rpc()` needs a per-name fake. Mirrors each function's refusals as `FakeRpcError`s.
 */

import { scrimNightEnd, type ScrimNight } from '../scrim-schedule';
import { FakeRpcError, nextId, type Row, type RpcHandler } from './fakeSupabase';

const toNight = (n: Row): ScrimNight => ({
  id: n.id as number,
  startsAt: n.starts_at as string,
  endedAt: n.ended_at as string | null,
  lastActiveAt: n.last_active_at as string | null,
});

/** Whether a night's slot (`scrimNightEnd()`) meets the one from `from` until a night starting then would go idle. */
const holdsServerFrom = (n: Row, from: string) =>
  Date.parse(n.starts_at as string) < scrimNightEnd({ id: 0, startsAt: from }) && scrimNightEnd(toNight(n)) > Date.parse(from);

export const scrimNightRpcs: Record<string, RpcHandler> = {
  start_scrim_night: (args, db) => {
    db.scrim_nights ??= [];
    db.scrim_signups ??= [];
    if (db.scrim_nights.some((n) => holdsServerFrom(n, args.p_starts_at as string))) {
      throw new FakeRpcError('overlapping-scrim-night');
    }
    const id = nextId(db.scrim_nights);
    db.scrim_nights.push({ id, starts_at: args.p_starts_at, ended_at: null, last_active_at: null });
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
  reopen_scrim_night: (args, db) => {
    const now = new Date().toISOString();
    const night = (db.scrim_nights ?? []).find((n) => n.id === args.p_night_id);
    if ((db.scrim_nights ?? []).some((n) => n.id !== args.p_night_id && holdsServerFrom(n, now))) {
      throw new FakeRpcError('current-scrim-night');
    }
    if (!night) throw new FakeRpcError(`Scrim night ${args.p_night_id} not found`);
    night.ended_at = null;
    night.last_active_at = now;
    return null;
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
