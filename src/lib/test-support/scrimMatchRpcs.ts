/**
 * Test-local fakes for the `create_scrim_match` / `set_scrim_match_lineup` / `queue_scrim_matches`
 * Postgres RPCs (`supabase/migrations/20261101140000_add_scrim_match_rpcs.sql`,
 * `20261102140000_add_queue_scrim_matches.sql`) — see fakeSupabase.ts's header on
 * why `.rpc()` needs a per-name fake. Mirrors each function's refusals as `FakeRpcError`s.
 */

import { FakeRpcError, type FakeDb, type RpcHandler } from './fakeSupabase';

function setLineup(db: FakeDb, matchId: number, shirts: number[], skins: number[]): void {
  const match = (db.matches ?? []).find((m) => m.id === matchId);
  if (!match || match.scrim_night_id == null) throw new FakeRpcError(`Match ${matchId} is not a scrim match`);
  if (match.final_score != null) throw new FakeRpcError(`Match ${matchId} already has a score`);
  if (shirts.length !== 2 || skins.length !== 2) throw new FakeRpcError('A scrim lineup needs two players per side');
  if (new Set([...shirts, ...skins]).size !== 4) throw new FakeRpcError('A scrim lineup cannot list a player twice');
  db.player_match_stats = (db.player_match_stats ?? []).filter((r) => r.match_id !== matchId);
  let id = Math.max(0, ...db.player_match_stats.map((r) => r.id as number)) + 1;
  for (const [faction, ids] of [['SHIRTS', shirts], ['SKINS', skins]] as const) {
    for (const playerId of ids) db.player_match_stats.push({ id: id++, match_id: matchId, player_id: playerId, faction });
  }
}

export const scrimMatchRpcs: Record<string, RpcHandler> = {
  set_scrim_match_lineup: (args, db) => {
    setLineup(db, args.p_match_id as number, args.p_shirts as number[], args.p_skins as number[]);
    return null;
  },
  queue_scrim_matches: (args, db) => {
    const nightId = args.p_night_id as number;
    if (!(db.scrim_nights ?? []).some((n) => n.id === nightId)) throw new FakeRpcError(`Scrim night ${nightId} not found`);
    db.matches ??= [];
    const nightMatches = db.matches.filter((m) => m.scrim_night_id === nightId);
    if (nightMatches.some((m) => m.final_score == null)) throw new FakeRpcError('unplayed-scrim-match');
    const queued = args.p_matches as { map: string; workshop_id: string; shirts: number[]; skins: number[] }[];
    if (queued.length === 0) throw new FakeRpcError('No matches to queue');
    let number = Math.max(0, ...nightMatches.map((m) => m.match_number as number));
    return queued.map((q) => {
      const id = Math.max(0, ...db.matches!.map((m) => m.id as number)) + 1;
      db.matches!.push({
        id, scrim_night_id: nightId, week_id: null, match_number: ++number,
        shirts_pick: q.map, scrim_workshop_id: q.workshop_id, scrim_side_choice: 'knife', final_score: null,
      });
      setLineup(db, id, q.shirts, q.skins);
      return id;
    });
  },
  create_scrim_match: (args, db) => {
    const nightId = args.p_night_id as number;
    if (!(db.scrim_nights ?? []).some((n) => n.id === nightId)) throw new FakeRpcError(`Scrim night ${nightId} not found`);
    db.matches ??= [];
    const nightMatches = db.matches.filter((m) => m.scrim_night_id === nightId);
    if (nightMatches.some((m) => m.final_score == null)) throw new FakeRpcError('unplayed-scrim-match');
    const id = Math.max(0, ...db.matches.map((m) => m.id as number)) + 1;
    db.matches.push({
      id,
      scrim_night_id: nightId,
      week_id: null,
      match_number: Math.max(0, ...nightMatches.map((m) => m.match_number as number)) + 1,
      shirts_pick: args.p_map,
      scrim_workshop_id: args.p_workshop_id,
      scrim_side_choice: 'knife',
      final_score: null,
    });
    setLineup(db, id, args.p_shirts as number[], args.p_skins as number[]);
    return id;
  },
};
