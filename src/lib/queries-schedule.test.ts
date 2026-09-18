/**
 * Regression harness for queries.ts's schedule functions (#63) — getSeasonSchedule,
 * getOtherScheduledMatches.
 *
 * Run:  npx vitest run src/lib/queries-schedule.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import { getSeasonSchedule, getOtherScheduledMatches, findCurrentWeek, findNextUnplayedWeek, getUpcomingGames, weekWindowMs, type WeekWithMatches, type MatchWithRoster } from './queries';
import { test, report } from './test-support/miniTest';

/** Minimal WeekWithMatches stand-ins — findCurrentWeek/weekWindowMs only read week_number and
 *  (for the "has matches" check elsewhere) matches.length, so nothing else needs to be real. */
function week(weekNumber: number, hasMatches = true): WeekWithMatches {
  return {
    id: weekNumber,
    season_id: 1,
    week_number: weekNumber,
    bye_player_id: null,
    bye_player_name: null,
    matches: hasMatches ? [{} as WeekWithMatches['matches'][number]] : [],
  };
}

/** A week stand-in for findNextUnplayedWeek — only final_score is read. */
function weekWithScores(weekNumber: number, finalScores: (string | null)[]): WeekWithMatches {
  return {
    ...week(weekNumber, false),
    matches: finalScores.map((final_score) => ({ final_score }) as WeekWithMatches['matches'][number]),
  };
}

/** A match stand-in for getUpcomingGames — only id, match_number, final_score, and scheduled_at
 *  are read. */
function matchStub(id: number, matchNumber: number, finalScore: string | null, scheduledAt: string | null): MatchWithRoster {
  return {
    id,
    match_number: matchNumber,
    final_score: finalScore,
    scheduled_at: scheduledAt,
  } as MatchWithRoster;
}

async function main() {
  await test('getSeasonSchedule(1) — regular season with a bye week, snapshot', async () => {
    const schedule = await getSeasonSchedule(1);
    assert.equal(schedule.length, 2);
    matchesSnapshot('getSeasonSchedule-1', schedule);
  });

  await test('getSeasonSchedule(3) — active season, only an unplayed match, snapshot', async () => {
    matchesSnapshot('getSeasonSchedule-3', await getSeasonSchedule(3));
  });

  await test('getSeasonSchedule(9999) — no weeks returns []', async () => {
    assert.deepEqual(await getSeasonSchedule(9999), []);
  });

  await test('getOtherScheduledMatches(999) — excludes played matches, only unplayed+scheduled, snapshot', async () => {
    const others = await getOtherScheduledMatches(999);
    // Only match 101 is unplayed AND scheduled in the fixture.
    assert.equal(others.length, 1);
    assert.equal(others[0].id, 101);
    matchesSnapshot('getOtherScheduledMatches-999', others);
  });

  await test('getOtherScheduledMatches(101) — excludes itself via .neq()', async () => {
    const others = await getOtherScheduledMatches(101);
    assert.equal(others.some((m) => m.id === 101), false);
  });

  await test('weekWindowMs: week 1 is the 7 days starting on start_date', () => {
    const win = weekWindowMs('2026-01-01', 1);
    assert.equal(win.start, Date.UTC(2026, 0, 1));
    assert.equal(win.end, Date.UTC(2026, 0, 8) - 1);
  });

  await test('weekWindowMs: week 3 starts 14 days after start_date', () => {
    const win = weekWindowMs('2026-01-01', 3);
    assert.equal(win.start, Date.UTC(2026, 0, 15));
  });

  await test('findCurrentWeek: empty schedule returns null', () => {
    assert.equal(findCurrentWeek([], '2026-01-01'), null);
  });

  await test('findCurrentWeek: no start_date falls back to the first week', () => {
    const schedule = [week(1), week(2)];
    assert.equal(findCurrentWeek(schedule, null), schedule[0]);
  });

  await test('findCurrentWeek: picks the week whose window contains today', () => {
    const now = Date.now();
    // start_date 21 days ago, at the start of week 1 -- today falls in week 4's window (days 21-27).
    const startDate = new Date(now - 21 * 86_400_000).toISOString().slice(0, 10);
    const schedule = [week(1), week(2), week(3), week(4), week(5)];
    const current = findCurrentWeek(schedule, startDate);
    assert.equal(current?.week_number, 4);
  });

  await test('findCurrentWeek: before the season starts returns the next upcoming week', () => {
    const startDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const schedule = [week(1), week(2)];
    assert.equal(findCurrentWeek(schedule, startDate)?.week_number, 1);
  });

  await test('findCurrentWeek: every window past returns the last week', () => {
    const startDate = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const schedule = [week(1), week(2)];
    assert.equal(findCurrentWeek(schedule, startDate)?.week_number, 2);
  });

  await test('findNextUnplayedWeek: empty schedule returns null', () => {
    assert.equal(findNextUnplayedWeek([]), null);
  });

  await test('findNextUnplayedWeek: skips a partially-played week for a fully-unplayed one', () => {
    // Week 10 has one played match and one unplayed one (out-of-order entry); week 11 hasn't
    // started at all — "next" for thread-publishing purposes is week 11, not week 10.
    const schedule = [
      weekWithScores(10, ['13-9', null]),
      weekWithScores(11, [null, null]),
    ];
    assert.equal(findNextUnplayedWeek(schedule)?.week_number, 11);
  });

  await test('findNextUnplayedWeek: treats a pre-staged "0-0" score as unplayed', () => {
    const schedule = [weekWithScores(10, ['0-0'])];
    assert.equal(findNextUnplayedWeek(schedule)?.week_number, 10);
  });

  await test('findNextUnplayedWeek: every week already has a played match falls back to the last week', () => {
    const schedule = [weekWithScores(10, ['13-9']), weekWithScores(11, ['13-5'])];
    assert.equal(findNextUnplayedWeek(schedule)?.week_number, 11);
  });

  await test('getUpcomingGames: scheduled bucket spans every week, soonest first, excludes played and "0-0" placeholder matches', () => {
    const schedule: WeekWithMatches[] = [
      { ...week(1, false), matches: [matchStub(1, 1, null, '2026-01-10T00:00:00Z'), matchStub(2, 2, '13-9', '2026-01-05T00:00:00Z')] },
      { ...week(2, false), matches: [matchStub(3, 1, null, '2026-01-03T00:00:00Z'), matchStub(4, 2, '0-0', '2026-01-04T00:00:00Z')] },
    ];
    const { scheduled } = getUpcomingGames(schedule, null);
    // Match 2 is played, so it's dropped; match 4's "0-0" is a pre-staged placeholder
    // (isPlayedScore()), so it still counts as unplayed and appears, sorted by scheduled_at.
    assert.deepEqual(scheduled.map((m) => m.id), [3, 4, 1]);
  });

  await test('getUpcomingGames: unscheduled bucket is only the current week\'s unplayed, unscheduled matches, by match number', () => {
    const startDate = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    // Every window is past, so findCurrentWeek() falls back to the last week (week 2) — its
    // unscheduled matches are what should appear, not week 1's.
    const schedule: WeekWithMatches[] = [
      { ...week(1, false), matches: [matchStub(1, 1, null, null)] },
      { ...week(2, false), matches: [matchStub(3, 2, null, null), matchStub(2, 1, '13-9', null), matchStub(4, 3, null, '2026-01-01T00:00:00Z')] },
    ];
    const { unscheduled } = getUpcomingGames(schedule, startDate);
    assert.deepEqual(unscheduled.map((m) => m.id), [3]);
  });

  await test('getUpcomingGames: empty schedule returns empty buckets', () => {
    assert.deepEqual(getUpcomingGames([], null), { scheduled: [], unscheduled: [] });
  });

  report();
}

await main();
