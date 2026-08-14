/**
 * Coverage for the DB-touching counterpart to season-schedule-engine.ts's pure planning:
 * generateSeasonScheduleDraft()/deleteSeasonScheduleDraft()/saveSeasonScheduleDraft()/
 * confirmSeasonScheduleDraft(), their shared schedule_draft_locked_at locking
 * (claimScheduleDraftLock()/withScheduleDraftLock()), the already-materialized guard
 * (assertScheduleNotYetMaterialized()), and mapScheduleDraftError()'s error-code mapping (#380).
 *
 * Both this file's functions (via their `supabaseAdmin` parameter) and the `./queries` helpers they
 * call into (`getSeasonRoster`, `getSeasonScheduleDraft`, both built on the module-level `supabase`
 * singleton) must point at the same fake db — hence wiring both `__setTestClient()` and passing the
 * fake as `supabaseAdmin` in every test below.
 *
 * Run:  npx vitest run src/lib/season-schedule-draft-engine.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient, type FakeDb } from './test-support/fakeSupabase';
import { test, report } from './test-support/miniTest';
import { buildRosterSchedule } from './season-schedule-engine';
import {
  generateSeasonScheduleDraft,
  deleteSeasonScheduleDraft,
  saveSeasonScheduleDraft,
  confirmSeasonScheduleDraft,
  mapScheduleDraftError,
  ScheduleDraftLockedError,
  ScheduleAlreadyMaterializedError,
} from './season-schedule-draft-engine';
import type { DraftScheduleWeek } from './season-schedule-validation';

const SEASON_ID = 1;
const ROSTER = [1, 2, 3, 4, 5, 6, 7];

function makeDb(): FakeDb {
  return {
    seasons: [{ id: SEASON_ID, name: 'Season 20', status: 'UPCOMING', is_gauntlet: false, schedule_draft_locked_at: null, target_win_rounds: 13 }],
    weeks: [],
    matches: [],
    player_match_stats: [],
    players: ROSTER.map((id) => ({ id, name: `Player ${id}` })),
    season_players: ROSTER.map((id, i) => ({ id: i + 1, season_id: SEASON_ID, player_id: id })),
    season_schedule_draft_weeks: [],
    season_schedule_draft_matches: [],
    ops_errors: [],
  };
}

function installFixture(db: FakeDb): ReturnType<typeof createFakeSupabaseClient> {
  const client = createFakeSupabaseClient(db);
  __setTestClient(client);
  return client;
}

function draftWeeksOf(db: FakeDb) {
  return (db.season_schedule_draft_weeks ?? []).filter((w) => w.season_id === SEASON_ID);
}
function draftMatchesOf(db: FakeDb, weekId: unknown) {
  return (db.season_schedule_draft_matches ?? []).filter((m) => m.draft_week_id === weekId);
}

const expectedWeekCount = buildRosterSchedule(ROSTER).length;

async function main() {
  // ─── generateSeasonScheduleDraft ────────────────────────────────────────────

  await test('generateSeasonScheduleDraft: persists one draft week+matches row set per planned week', async () => {
    const db = makeDb();
    const client = installFixture(db);
    await generateSeasonScheduleDraft(client as never, SEASON_ID, ROSTER);

    const weeks = draftWeeksOf(db);
    assert.equal(weeks.length, expectedWeekCount);
    for (const w of weeks) {
      assert.ok(draftMatchesOf(db, w.id).length > 0);
    }
  });

  await test('generateSeasonScheduleDraft: regenerating replaces the previous draft wholesale', async () => {
    const db = makeDb();
    const client = installFixture(db);
    await generateSeasonScheduleDraft(client as never, SEASON_ID, ROSTER);
    // Hand-edit a bye so a stale leftover from the first generation would be detectable.
    const firstWeek1 = draftWeeksOf(db).find((w) => w.week_number === 1)!;
    firstWeek1.bye_player_id = -1;

    await generateSeasonScheduleDraft(client as never, SEASON_ID, ROSTER);
    const secondWeekIds = draftWeeksOf(db).map((w) => w.id);

    assert.equal(secondWeekIds.length, expectedWeekCount);
    assert.ok(draftWeeksOf(db).every((w) => w.bye_player_id !== -1), 'the hand-edited leftover from the first generation must be gone');
    // Old matches referencing the deleted week rows must not linger.
    assert.ok(db.season_schedule_draft_matches.every((m) => secondWeekIds.includes(m.draft_week_id)));
  });

  await test('generateSeasonScheduleDraft: refuses once the season has a real (materialized) schedule', async () => {
    const db = makeDb();
    db.weeks.push({ id: 999, season_id: SEASON_ID, week_number: 1, bye_player_id: null });
    const client = installFixture(db);
    await assert.rejects(() => generateSeasonScheduleDraft(client as never, SEASON_ID, ROSTER), ScheduleAlreadyMaterializedError);
  });

  // ─── deleteSeasonScheduleDraft ───────────────────────────────────────────────

  await test('deleteSeasonScheduleDraft: removes every draft week and match for the season', async () => {
    const db = makeDb();
    const client = installFixture(db);
    await generateSeasonScheduleDraft(client as never, SEASON_ID, ROSTER);
    assert.ok(draftWeeksOf(db).length > 0);

    await deleteSeasonScheduleDraft(client as never, SEASON_ID);
    assert.equal(draftWeeksOf(db).length, 0);
    assert.equal(db.season_schedule_draft_matches.length, 0);
  });

  await test('deleteSeasonScheduleDraft: refuses once the season has a real schedule', async () => {
    const db = makeDb();
    db.weeks.push({ id: 999, season_id: SEASON_ID, week_number: 1, bye_player_id: null });
    const client = installFixture(db);
    await assert.rejects(() => deleteSeasonScheduleDraft(client as never, SEASON_ID), ScheduleAlreadyMaterializedError);
  });

  // ─── saveSeasonScheduleDraft ─────────────────────────────────────────────────

  await test('saveSeasonScheduleDraft: an integrity violation is rejected without writing anything', async () => {
    const db = makeDb();
    const client = installFixture(db);
    await generateSeasonScheduleDraft(client as never, SEASON_ID, ROSTER);
    const before = JSON.stringify(db.season_schedule_draft_matches);

    // Two weeks claiming the same week_number is a duplicate-week integrity violation.
    const badWeeks: DraftScheduleWeek[] = [
      { week_number: 1, bye_player_id: null, matches: [{ match_number: 1, shirts: [1, 2], skins: [3, 4] }] },
      { week_number: 1, bye_player_id: null, matches: [{ match_number: 1, shirts: [1, 2], skins: [3, 4] }] },
    ];
    const result = await saveSeasonScheduleDraft(client as never, SEASON_ID, badWeeks);
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(db.season_schedule_draft_matches), before);
  });

  await test('saveSeasonScheduleDraft: reassigns bye/match participants for existing draft rows', async () => {
    const db = makeDb();
    const client = installFixture(db);
    await generateSeasonScheduleDraft(client as never, SEASON_ID, ROSTER);
    const week1 = draftWeeksOf(db).find((w) => w.week_number === 1)!;
    const match1 = draftMatchesOf(db, week1.id).find((m) => m.match_number === 1)!;

    const edited: DraftScheduleWeek[] = [{ week_number: 1, bye_player_id: 7, matches: [{ match_number: 1, shirts: [1, 3], skins: [2, 4] }] }];
    const result = await saveSeasonScheduleDraft(client as never, SEASON_ID, edited);
    assert.deepEqual(result, { ok: true });

    const updatedWeek = db.season_schedule_draft_weeks.find((w) => w.id === week1.id)!;
    assert.equal(updatedWeek.bye_player_id, 7);
    const updatedMatch = db.season_schedule_draft_matches.find((m) => m.id === match1.id)!;
    assert.deepEqual(
      [updatedMatch.shirts_player1_id, updatedMatch.shirts_player2_id, updatedMatch.skins_player1_id, updatedMatch.skins_player2_id],
      [1, 3, 2, 4],
    );
  });

  await test('saveSeasonScheduleDraft: a week_number with no matching draft row throws', async () => {
    const db = makeDb();
    const client = installFixture(db);
    await generateSeasonScheduleDraft(client as never, SEASON_ID, ROSTER);

    const edited: DraftScheduleWeek[] = [{ week_number: 999, bye_player_id: null, matches: [] }];
    await assert.rejects(() => saveSeasonScheduleDraft(client as never, SEASON_ID, edited), /no draft week 999 exists/);
  });

  await test('saveSeasonScheduleDraft: refuses once the season has a real schedule', async () => {
    const db = makeDb();
    db.weeks.push({ id: 999, season_id: SEASON_ID, week_number: 1, bye_player_id: null });
    const client = installFixture(db);
    await assert.rejects(() => saveSeasonScheduleDraft(client as never, SEASON_ID, []), ScheduleAlreadyMaterializedError);
  });

  // ─── confirmSeasonScheduleDraft ──────────────────────────────────────────────

  await test('confirmSeasonScheduleDraft: no-draft when nothing has been generated yet', async () => {
    const db = makeDb();
    const client = installFixture(db);
    const result = await confirmSeasonScheduleDraft(client as never, SEASON_ID);
    assert.deepEqual(result, { status: 'no-draft' });
  });

  await test('confirmSeasonScheduleDraft: already-materialized once the season has real weeks', async () => {
    const db = makeDb();
    db.weeks.push({ id: 999, season_id: SEASON_ID, week_number: 1, bye_player_id: null });
    const client = installFixture(db);
    const result = await confirmSeasonScheduleDraft(client as never, SEASON_ID);
    assert.deepEqual(result, { status: 'already-materialized' });
  });

  await test('confirmSeasonScheduleDraft: invalid when the draft doesn\'t cover every roster pair yet', async () => {
    const db = makeDb();
    const client = installFixture(db);
    // Persist only the FIRST planned week — a single week of a 7-player round robin can't possibly
    // cover every teammate/opponent pair, so completeness must fail.
    const plan = buildRosterSchedule(ROSTER);
    await generateSeasonScheduleDraft(client as never, SEASON_ID, ROSTER);
    await deleteSeasonScheduleDraft(client as never, SEASON_ID);
    const { data: weekRow } = await client
      .from('season_schedule_draft_weeks')
      .insert({ season_id: SEASON_ID, week_number: plan[0].week, bye_player_id: plan[0].byePlayerIds[0] ?? null })
      .select('id')
      .single();
    const weekId = (weekRow as { id: number }).id;
    await client.from('season_schedule_draft_matches').insert(
      plan[0].matches.map((m, i) => ({
        draft_week_id: weekId,
        match_number: i + 1,
        shirts_player1_id: m.shirts[0],
        shirts_player2_id: m.shirts[1],
        skins_player1_id: m.skins[0],
        skins_player2_id: m.skins[1],
      })),
    );

    const result = await confirmSeasonScheduleDraft(client as never, SEASON_ID);
    assert.equal(result.status, 'invalid');
    assert.ok(result.status === 'invalid' && (result.missingTeammatePairs.length > 0 || result.missingOpponentPairs.length > 0));
  });

  await test('confirmSeasonScheduleDraft: a complete draft materializes into real weeks/matches/player_match_stats', async () => {
    const db = makeDb();
    const client = installFixture(db);
    await generateSeasonScheduleDraft(client as never, SEASON_ID, ROSTER);

    const result = await confirmSeasonScheduleDraft(client as never, SEASON_ID);
    assert.equal(result.status, 'confirmed');
    assert.ok(result.status === 'confirmed');
    assert.equal(result.weeksCreated, expectedWeekCount);
    assert.equal(db.weeks.filter((w) => w.season_id === SEASON_ID).length, expectedWeekCount);
    assert.equal(db.matches.length, result.matchesCreated);
    assert.equal(db.player_match_stats.length, result.matchesCreated * 4);
    assert.ok(db.matches.every((m) => m.is_playoff_game === false && m.final_score === null));

    // Confirming twice must not double-materialize.
    const again = await confirmSeasonScheduleDraft(client as never, SEASON_ID);
    assert.deepEqual(again, { status: 'already-materialized' });
  });

  // ─── locking ──────────────────────────────────────────────────────────────

  await test('the schedule draft lock rejects a concurrent operation and is released after success', async () => {
    const db = makeDb();
    db.seasons[0].schedule_draft_locked_at = new Date().toISOString(); // fresh lock, still held
    const client = installFixture(db);
    await assert.rejects(() => generateSeasonScheduleDraft(client as never, SEASON_ID, ROSTER), ScheduleDraftLockedError);

    db.seasons[0].schedule_draft_locked_at = null;
    await generateSeasonScheduleDraft(client as never, SEASON_ID, ROSTER); // now succeeds
    assert.equal(db.seasons[0].schedule_draft_locked_at, null, 'the lock must be released after the operation completes');
  });

  await test('a stale lock (older than the staleness window) is treated as free', async () => {
    const db = makeDb();
    db.seasons[0].schedule_draft_locked_at = new Date(Date.now() - 120_000).toISOString(); // 2 minutes ago
    const client = installFixture(db);
    await generateSeasonScheduleDraft(client as never, SEASON_ID, ROSTER); // must not throw
    assert.equal(draftWeeksOf(db).length, expectedWeekCount);
  });

  // ─── mapScheduleDraftError ───────────────────────────────────────────────────

  await test('mapScheduleDraftError: lock and materialized errors map to 409, everything else to 500', async () => {
    assert.deepEqual(mapScheduleDraftError(new ScheduleDraftLockedError(SEASON_ID)), {
      error: `Another schedule draft operation is already in progress for season ${SEASON_ID} — try again shortly`,
      status: 409,
    });
    assert.deepEqual(mapScheduleDraftError(new ScheduleAlreadyMaterializedError(SEASON_ID)), {
      error: `Season ${SEASON_ID}'s schedule has already been confirmed — its draft can no longer be edited`,
      status: 409,
    });
    assert.deepEqual(mapScheduleDraftError(new Error('boom')), { error: 'boom', status: 500 });
  });

  report();
}

await main();
