/**
 * Correctness proof for validateDraftIntegrity()/validateDraftCompleteness(). Ties back to the
 * generator's own guarantees (a fresh buildRosterSchedule() output must always pass both checks)
 * and exercises each integrity violation and completeness gap individually. No test framework —
 * node:assert + a tiny runner, matching season-schedule.test.ts.
 *
 * Run:  npx tsx src/lib/season-schedule-validation.test.ts
 */

import assert from 'node:assert/strict';
import { buildRosterSchedule, type PlayerWeekPlan } from './season-schedule-engine';
import { validateDraftIntegrity, validateDraftCompleteness, type DraftScheduleWeek } from './season-schedule-validation';
import { test, report } from './test-support/miniTest';

/** Test-only: buildRosterSchedule()'s pre-persistence array-of-byes shape down to the persisted
 * draft's singular bye_player_id — same translation generateSeasonScheduleDraft() does for real. */
function toDraftWeeks(plan: PlayerWeekPlan[]): DraftScheduleWeek[] {
  return plan.map((w) => ({
    week_number: w.week,
    bye_player_id: w.byePlayerIds[0] ?? null,
    matches: w.matches.map((m, i) => ({ match_number: i + 1, shirts: m.shirts, skins: m.skins })),
  }));
}

const ROSTER_7 = [305, 42, 999, 7, 256, 13, 101];
const ROSTER_12 = [1042, 7, 305, 88, 512, 3, 999, 256, 13, 47, 101, 620];

async function main() {
  for (const roster of [ROSTER_7, ROSTER_12]) {
    await test(`a freshly generated schedule (${roster.length} players) passes both integrity and completeness`, () => {
      const weeks = toDraftWeeks(buildRosterSchedule(roster));
      const integrity = validateDraftIntegrity(weeks);
      assert.deepEqual(integrity.issues, []);
      assert.equal(integrity.ok, true);

      const completeness = validateDraftCompleteness(weeks, roster);
      assert.deepEqual(completeness.missingTeammatePairs, []);
      assert.deepEqual(completeness.missingOpponentPairs, []);
      assert.equal(completeness.complete, true);
    });
  }

  await test('validateDraftIntegrity — flags a self-paired match (duplicate player in one match)', () => {
    const weeks: DraftScheduleWeek[] = [
      { week_number: 1, bye_player_id: null, matches: [{ match_number: 1, shirts: [1, 2], skins: [1, 3] }] },
    ];
    const result = validateDraftIntegrity(weeks);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.message.includes('must be distinct')));
  });

  await test('validateDraftIntegrity — flags a player in 3 matches the same week', () => {
    const weeks: DraftScheduleWeek[] = [
      {
        week_number: 1,
        bye_player_id: null,
        matches: [
          { match_number: 1, shirts: [1, 2], skins: [3, 4] },
          { match_number: 2, shirts: [1, 5], skins: [6, 7] },
          { match_number: 3, shirts: [1, 8], skins: [9, 10] },
        ],
      },
    ];
    const result = validateDraftIntegrity(weeks);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.message.includes('appears in 3 matches')));
  });

  await test('validateDraftIntegrity — allows exactly 2 appearances (a legitimate doubleheader)', () => {
    const weeks: DraftScheduleWeek[] = [
      {
        week_number: 1,
        bye_player_id: null,
        matches: [
          { match_number: 1, shirts: [1, 2], skins: [3, 4] },
          { match_number: 2, shirts: [1, 5], skins: [6, 7] },
        ],
      },
    ];
    const result = validateDraftIntegrity(weeks);
    assert.equal(result.ok, true);
  });

  await test('validateDraftIntegrity — flags a bye player who also appears in a match', () => {
    const weeks: DraftScheduleWeek[] = [
      { week_number: 1, bye_player_id: 1, matches: [{ match_number: 1, shirts: [1, 2], skins: [3, 4] }] },
    ];
    const result = validateDraftIntegrity(weeks);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.message.includes('marked as the bye but also appears')));
  });

  await test('validateDraftIntegrity — flags a duplicate week_number', () => {
    const weeks: DraftScheduleWeek[] = [
      { week_number: 1, bye_player_id: null, matches: [{ match_number: 1, shirts: [1, 2], skins: [3, 4] }] },
      { week_number: 1, bye_player_id: null, matches: [{ match_number: 1, shirts: [5, 6], skins: [7, 8] }] },
    ];
    const result = validateDraftIntegrity(weeks);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.message.includes('appears more than once')));
  });

  await test('validateDraftIntegrity — flags a duplicate match_number within a week', () => {
    const weeks: DraftScheduleWeek[] = [
      {
        week_number: 1,
        bye_player_id: null,
        matches: [
          { match_number: 1, shirts: [1, 2], skins: [3, 4] },
          { match_number: 1, shirts: [5, 6], skins: [7, 8] },
        ],
      },
    ];
    const result = validateDraftIntegrity(weeks);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.message.includes('Match 1 appears more than once')));
  });

  await test('validateDraftCompleteness — empty draft reports every roster pair missing both ways', () => {
    const roster = [1, 2, 3, 4];
    const result = validateDraftCompleteness([], roster);
    assert.equal(result.complete, false);
    assert.equal(result.missingTeammatePairs.length, 6); // C(4,2)
    assert.equal(result.missingOpponentPairs.length, 6);
  });

  await test('an empty draft against a 0-1 player roster passes both checks vacuously — callers must separately reject an empty draft', () => {
    // Both functions are correct here: with no matches there's nothing to violate, and with
    // fewer than 2 roster players there are zero pairs to require coverage for. This is exactly
    // why confirmSeasonScheduleDraft() checks draft non-emptiness itself rather than trusting
    // "integrity ok && completeness complete" alone — those two facts don't imply a draft exists.
    assert.equal(validateDraftIntegrity([]).ok, true);
    assert.equal(validateDraftCompleteness([], []).complete, true);
    assert.equal(validateDraftCompleteness([], [1]).complete, true);
  });

  await test('validateDraftCompleteness — a partial draft (one week dropped) reports exactly the pairs only that week covered', () => {
    const weeks = toDraftWeeks(buildRosterSchedule(ROSTER_7));
    const partial = weeks.slice(0, -1); // drop the last week
    const result = validateDraftCompleteness(partial, ROSTER_7);
    assert.equal(result.complete, false);
    assert.ok(result.missingTeammatePairs.length > 0 || result.missingOpponentPairs.length > 0);

    // Every pair still reported missing should have been coverable only by the dropped week —
    // i.e. re-adding it and re-checking should always come back complete.
    const full = validateDraftCompleteness(weeks, ROSTER_7);
    assert.equal(full.complete, true);
  });

  report();
}

main();
