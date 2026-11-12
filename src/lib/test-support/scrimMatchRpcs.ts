/**
 * Test-local fakes for the scrim match Postgres RPCs — `set_scrim_match_lineup`,
 * `queue_scrim_matches`, `update_scrim_match`, `discard_scrim_match` and `claim_scrim_match_start`
 * (`supabase/migrations/20261101140000_add_scrim_match_rpcs.sql`,
 * `20261102140000_add_queue_scrim_matches.sql`, `20261110120000_add_scrim_match_revision.sql`) — see
 * fakeSupabase.ts's header on why `.rpc()` needs a per-name fake. Mirrors each function's refusals as
 * `FakeRpcError`s. A fixture row without `scrim_revision` is at revision 0.
 */

import { FakeRpcError, nextId, type FakeDb, type Row, type RpcHandler } from './fakeSupabase';

/** `lock_scrim_match_at_revision()`: the scrim match, refusing a missing one or a moved revision. */
function matchAtRevision(db: FakeDb, matchId: number, revision: number): Row {
  const match = (db.matches ?? []).find((m) => m.id === matchId);
  if (!match) throw new FakeRpcError('scrim-match-changed');
  if (match.scrim_night_id == null) throw new FakeRpcError(`Match ${matchId} is not a scrim match`);
  if (((match.scrim_revision as number | undefined) ?? 0) !== revision) throw new FakeRpcError('scrim-match-changed');
  return match;
}

const serverStateOf = (db: FakeDb, matchId: number) => (db.match_server_state ?? []).find((s) => s.match_id === matchId)?.server_state as string | undefined;

function bumpRevision(match: Row): number {
  match.scrim_revision = ((match.scrim_revision as number | undefined) ?? 0) + 1;
  return match.scrim_revision as number;
}

function setLineup(db: FakeDb, matchId: number, shirts: number[], skins: number[]): void {
  const match = (db.matches ?? []).find((m) => m.id === matchId);
  if (!match || match.scrim_night_id == null) throw new FakeRpcError(`Match ${matchId} is not a scrim match`);
  if (match.final_score != null) throw new FakeRpcError(`Match ${matchId} already has a score`);
  if (shirts.length !== 2 || skins.length !== 2) throw new FakeRpcError('A scrim lineup needs two players per side');
  if (new Set([...shirts, ...skins]).size !== 4) throw new FakeRpcError('A scrim lineup cannot list a player twice');
  db.player_match_stats = (db.player_match_stats ?? []).filter((r) => r.match_id !== matchId);
  let id = nextId(db.player_match_stats);
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
    const gameOver = (id: unknown) => (db.match_server_state ?? []).some((s) => s.match_id === id && (s.server_state === 'done' || s.server_state === 'tearing_down'));
    if (nightMatches.some((m) => m.final_score == null && !gameOver(m.id))) throw new FakeRpcError('unplayed-scrim-match');
    const queued = args.p_matches as { map: string; workshop_id: string; shirts: number[]; skins: number[] }[];
    if (queued.length === 0) throw new FakeRpcError('No matches to queue');
    let number = Math.max(0, ...nightMatches.map((m) => m.match_number as number));
    return queued.map((q) => {
      const id = nextId(db.matches!);
      db.matches!.push({
        id, scrim_night_id: nightId, week_id: null, match_number: ++number,
        shirts_pick: q.map, scrim_workshop_id: q.workshop_id, scrim_side_choice: 'knife', scrim_revision: 0, final_score: null,
      });
      setLineup(db, id, q.shirts, q.skins);
      return id;
    });
  },
  update_scrim_match: (args, db) => {
    const matchId = args.p_match_id as number;
    const match = matchAtRevision(db, matchId, args.p_revision as number);
    const state = serverStateOf(db, matchId);
    if (match.final_score != null || (state && ['provisioning', 'live', 'tearing_down', 'done'].includes(state))) {
      throw new FakeRpcError('scrim-match-locked');
    }
    if ((args.p_map == null) !== (args.p_workshop_id == null)) throw new FakeRpcError('A scrim map needs both its name and its workshop id');
    // The lineup goes first: it is the only part that can still refuse, so a refusal writes nothing.
    if (args.p_shirts != null || args.p_skins != null) setLineup(db, matchId, (args.p_shirts as number[]) ?? [], (args.p_skins as number[]) ?? []);
    if (args.p_map != null) Object.assign(match, { shirts_pick: args.p_map, scrim_workshop_id: args.p_workshop_id });
    if (args.p_side_choice != null) Object.assign(match, { scrim_side_choice: args.p_side_choice, skins_starting_side: null });
    return bumpRevision(match);
  },
  discard_scrim_match: (args, db) => {
    const matchId = args.p_match_id as number;
    const match = matchAtRevision(db, matchId, args.p_revision as number);
    const state = serverStateOf(db, matchId);
    if (match.final_score != null || (state && ['provisioning', 'live', 'tearing_down'].includes(state))) throw new FakeRpcError('scrim-match-running');
    db.matches = db.matches.filter((m) => m.id !== matchId);
    db.player_match_stats = (db.player_match_stats ?? []).filter((r) => r.match_id !== matchId);
    return null;
  },
  claim_scrim_match_start: (args, db) => bumpRevision(matchAtRevision(db, args.p_match_id as number, args.p_revision as number)),
};
