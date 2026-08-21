/**
 * Test-local fakes for the five `*_season_schedule_draft` Postgres RPCs
 * (`supabase/migrations/20260820160000_atomic_season_schedule_draft_rpcs.sql`) — see
 * fakeSupabase.ts's own header comment on why `.rpc()` has no generic in-memory equivalent and
 * needs a per-name fake registered by the test that exercises it. Shared by every test that drives
 * `season-schedule-draft-engine.ts` far enough to reach one of these RPC calls.
 *
 * The real functions run inside one Postgres transaction and rely on `on delete cascade` (`weeks`
 * -> `matches` -> `player_match_stats`) for rollback's deletes — this fake has no transactions to
 * roll back (every mutation here is already atomic JS, no partial-failure path exists to simulate)
 * and no FK cascade, so `confirm`'s inserts and `rollback`'s deletes are done by hand in the same
 * shape the real cascade would produce.
 */

import type { FakeDb, RpcHandler } from './fakeSupabase';
import { isPlayedScore } from '../util';

type RpcWeek = {
  week_number: number;
  bye_player_id: number | null;
  matches: {
    match_number: number;
    shirts_player1_id: number;
    shirts_player2_id: number;
    skins_player1_id: number;
    skins_player2_id: number;
  }[];
};

const ZERO_MATCH_STATS = {
  kills: 0,
  assists: 0,
  deaths: 0,
  damage: 0,
  adr: 0,
  rounds_played: 0,
  rounds_won: 0,
  is_win: false,
};

function nextId(rows: Row[]): number {
  return 1 + Math.max(0, ...rows.map((r) => (typeof r.id === 'number' ? r.id : 0)));
}

type Row = Record<string, unknown>;

function isMaterialized(db: FakeDb, seasonId: number): boolean {
  return (db.weeks ?? []).some((w) => w.season_id === seasonId);
}

function draftWeeksOf(db: FakeDb, seasonId: number): Row[] {
  return (db.season_schedule_draft_weeks ?? []).filter((w) => w.season_id === seasonId);
}

function draftMatchesOf(db: FakeDb, draftWeekId: unknown): Row[] {
  return (db.season_schedule_draft_matches ?? []).filter((m) => m.draft_week_id === draftWeekId);
}

/** Deletes a season's draft (matches, then weeks) — the shared body behind the `generate` and
 * `delete` fakes below, mirroring the real functions' own shared delete sequence. */
function deleteDraft(db: FakeDb, seasonId: number): void {
  const weekIds = draftWeeksOf(db, seasonId).map((w) => w.id);
  db.season_schedule_draft_matches = (db.season_schedule_draft_matches ?? []).filter((m) => !weekIds.includes(m.draft_week_id));
  db.season_schedule_draft_weeks = (db.season_schedule_draft_weeks ?? []).filter((w) => w.season_id !== seasonId);
}

function insertDraft(db: FakeDb, seasonId: number, weeks: RpcWeek[]): void {
  db.season_schedule_draft_weeks ??= [];
  db.season_schedule_draft_matches ??= [];
  for (const week of weeks) {
    const weekId = nextId(db.season_schedule_draft_weeks);
    db.season_schedule_draft_weeks.push({
      id: weekId,
      season_id: seasonId,
      week_number: week.week_number,
      bye_player_id: week.bye_player_id,
    });
    for (const match of week.matches) {
      db.season_schedule_draft_matches.push({
        id: nextId(db.season_schedule_draft_matches),
        draft_week_id: weekId,
        match_number: match.match_number,
        shirts_player1_id: match.shirts_player1_id,
        shirts_player2_id: match.shirts_player2_id,
        skins_player1_id: match.skins_player1_id,
        skins_player2_id: match.skins_player2_id,
      });
    }
  }
}

function makeGenerate(): RpcHandler {
  return (args, db) => {
    const seasonId = args.p_season_id as number;
    if (isMaterialized(db, seasonId)) return { status: 'already-materialized' };
    deleteDraft(db, seasonId);
    insertDraft(db, seasonId, args.p_weeks as RpcWeek[]);
    return { status: 'ok' };
  };
}

function makeDelete(): RpcHandler {
  return (args, db) => {
    const seasonId = args.p_season_id as number;
    if (isMaterialized(db, seasonId)) return { status: 'already-materialized' };
    deleteDraft(db, seasonId);
    return { status: 'ok' };
  };
}

function makeSave(): RpcHandler {
  return (args, db) => {
    const seasonId = args.p_season_id as number;
    if (isMaterialized(db, seasonId)) return { status: 'already-materialized' };

    for (const week of args.p_weeks as RpcWeek[]) {
      const weekRow = draftWeeksOf(db, seasonId).find((w) => w.week_number === week.week_number);
      if (!weekRow) {
        throw new Error(`save_season_schedule_draft: no draft week ${week.week_number} exists for season ${seasonId}`);
      }
      weekRow.bye_player_id = week.bye_player_id;

      for (const match of week.matches) {
        const matchRow = draftMatchesOf(db, weekRow.id).find((m) => m.match_number === match.match_number);
        if (!matchRow) {
          throw new Error(
            `save_season_schedule_draft: no draft match ${match.match_number} in week ${week.week_number} exists for season ${seasonId}`,
          );
        }
        matchRow.shirts_player1_id = match.shirts_player1_id;
        matchRow.shirts_player2_id = match.shirts_player2_id;
        matchRow.skins_player1_id = match.skins_player1_id;
        matchRow.skins_player2_id = match.skins_player2_id;
      }
    }
    return { status: 'ok' };
  };
}

function makeConfirm(): RpcHandler {
  return (args, db) => {
    const seasonId = args.p_season_id as number;
    if (isMaterialized(db, seasonId)) return { status: 'already-materialized' };

    const draftWeeks = draftWeeksOf(db, seasonId).sort((a, b) => (a.week_number as number) - (b.week_number as number));
    if (draftWeeks.length === 0) return { status: 'no-draft' };

    db.weeks ??= [];
    db.matches ??= [];
    db.player_match_stats ??= [];
    let weeksCreated = 0;
    let matchesCreated = 0;

    for (const draftWeek of draftWeeks) {
      const weekId = nextId(db.weeks);
      db.weeks.push({ id: weekId, season_id: seasonId, week_number: draftWeek.week_number, bye_player_id: draftWeek.bye_player_id });
      weeksCreated++;

      const draftMatches = draftMatchesOf(db, draftWeek.id).sort((a, b) => (a.match_number as number) - (b.match_number as number));
      for (const draftMatch of draftMatches) {
        const matchId = nextId(db.matches);
        db.matches.push({
          id: matchId,
          week_id: weekId,
          match_number: draftMatch.match_number,
          is_playoff_game: false,
          final_score: null,
          picked_map: null,
          shirts_ban: null,
          shirts_ban2: null,
          skins_ban1: null,
          skins_ban2: null,
          shirts_pick: null,
          skins_starting_side: null,
        });
        matchesCreated++;

        db.player_match_stats.push(
          { id: nextId(db.player_match_stats), match_id: matchId, player_id: draftMatch.shirts_player1_id, faction: 'SHIRTS', ...ZERO_MATCH_STATS },
          { id: nextId(db.player_match_stats), match_id: matchId, player_id: draftMatch.shirts_player2_id, faction: 'SHIRTS', ...ZERO_MATCH_STATS },
          { id: nextId(db.player_match_stats), match_id: matchId, player_id: draftMatch.skins_player1_id, faction: 'SKINS', ...ZERO_MATCH_STATS },
          { id: nextId(db.player_match_stats), match_id: matchId, player_id: draftMatch.skins_player2_id, faction: 'SKINS', ...ZERO_MATCH_STATS },
        );
      }
    }

    return { status: 'confirmed', weeks_created: weeksCreated, matches_created: matchesCreated };
  };
}

function makeRollback(): RpcHandler {
  return (args, db) => {
    const seasonId = args.p_season_id as number;
    const seasonWeeks = (db.weeks ?? []).filter((w) => w.season_id === seasonId);
    if (seasonWeeks.length === 0) return { status: 'not-materialized' };

    const isWeekPlayed = (weekId: unknown) =>
      (db.matches ?? []).some((m) => m.week_id === weekId && isPlayedScore(m.final_score as string | null));

    const deletableWeekIds = seasonWeeks.filter((w) => !isWeekPlayed(w.id)).map((w) => w.id);
    const protectedWeekNumbers = seasonWeeks
      .filter((w) => !deletableWeekIds.includes(w.id))
      .map((w) => w.week_number as number)
      .sort((a, b) => a - b);

    const deletableMatchIds = (db.matches ?? []).filter((m) => deletableWeekIds.includes(m.week_id)).map((m) => m.id);
    db.player_match_stats = (db.player_match_stats ?? []).filter((s) => !deletableMatchIds.includes(s.match_id));
    db.matches = (db.matches ?? []).filter((m) => !deletableMatchIds.includes(m.id));
    db.weeks = (db.weeks ?? []).filter((w) => !deletableWeekIds.includes(w.id));

    return { status: 'rolled-back', weeks_deleted: deletableWeekIds.length, protected_week_numbers: protectedWeekNumbers };
  };
}

/** Registers all five RPC fakes at once — pass as `createFakeSupabaseClient(db,
 * makeSeasonScheduleDraftRpcHandlers())`. */
export function makeSeasonScheduleDraftRpcHandlers(): Record<string, RpcHandler> {
  return {
    generate_season_schedule_draft: makeGenerate(),
    save_season_schedule_draft: makeSave(),
    delete_season_schedule_draft: makeDelete(),
    confirm_season_schedule_draft: makeConfirm(),
    rollback_season_schedule_draft: makeRollback(),
  };
}
