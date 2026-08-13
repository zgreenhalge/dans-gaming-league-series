/**
 * Regression harness for queries/season-schedule-draft.ts — hasSeasonScheduleDraft(),
 * getSeasonScheduleDraft(), toDraftScheduleWeeks(). The only file in src/lib/queries/ with real
 * logic that previously lacked a queries-*.test.ts sibling (#380).
 *
 * Run:  npx tsx src/lib/queries-season-schedule-draft.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient, type FakeDb } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import { hasSeasonScheduleDraft, getSeasonScheduleDraft, toDraftScheduleWeeks } from './queries';
import { test, report } from './test-support/miniTest';

async function main() {
  await test('hasSeasonScheduleDraft: true for a season with draft rows (Season 6, id 3)', async () => {
    assert.equal(await hasSeasonScheduleDraft(3), true);
  });

  await test('hasSeasonScheduleDraft: false for a season with none yet (Season 5, id 1)', async () => {
    assert.equal(await hasSeasonScheduleDraft(1), false);
  });

  await test('getSeasonScheduleDraft: empty for a season with no draft', async () => {
    assert.deepEqual(await getSeasonScheduleDraft(1), []);
  });

  await test('getSeasonScheduleDraft: joins the fixture draft to real player rows, sorted by week/match number', async () => {
    const weeks = await getSeasonScheduleDraft(3);
    assert.equal(weeks.length, 1);
    const [week] = weeks;
    assert.equal(week.week_number, 1);
    assert.equal(week.bye_player?.id, 5);
    assert.equal(week.bye_player?.name, 'Erin');
    assert.equal(week.matches.length, 1);
    assert.deepEqual(week.matches[0].shirts.map((p) => p.id), [1, 2]);
    assert.deepEqual(week.matches[0].skins.map((p) => p.id), [3, 4]);
  });

  await test('getSeasonScheduleDraft: a draft match referencing an unknown player_id throws', async () => {
    const db: FakeDb = {
      players: [{ id: 1, name: 'Solo' }],
      season_schedule_draft_weeks: [{ id: 1, season_id: 50, week_number: 1, bye_player_id: null }],
      season_schedule_draft_matches: [
        { id: 1, draft_week_id: 1, match_number: 1, shirts_player1_id: 1, shirts_player2_id: 404, skins_player1_id: 1, skins_player2_id: 1 },
      ],
    };
    __setTestClient(createFakeSupabaseClient(db));
    await assert.rejects(() => getSeasonScheduleDraft(50), /player_id 404 not found/);
    __setTestClient(createFakeSupabaseClient(buildFakeDb()));
  });

  await test('toDraftScheduleWeeks: down-projects the player-joined shape to plain ids', async () => {
    const weeks = await getSeasonScheduleDraft(3);
    assert.deepEqual(toDraftScheduleWeeks(weeks), [
      {
        week_number: 1,
        bye_player_id: 5,
        matches: [{ match_number: 1, shirts: [1, 2], skins: [3, 4] }],
      },
    ]);
  });

  report();
}

main();
