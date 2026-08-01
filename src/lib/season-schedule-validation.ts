/**
 * The two-tier check every draft schedule change goes through, mirroring gauntlet's editor
 * (`saveManualDraft()` in `gauntlet-engine.ts`): `validateDraftIntegrity()` is hard and blocks
 * saving a draft — structural soundness a draft must never violate, whether generated or
 * hand-edited. `validateDraftCompleteness()` is soft and status-only — it never blocks a save
 * (building a season's matchups out is expected to pass through incomplete states), but it's the
 * gate `confirm` (materializing a draft into real `weeks`/`matches`) requires *in addition to*
 * integrity. Both are pure — they operate on plain player_ids, not the DB or the
 * player-object-joined shape `getSeasonScheduleDraft()` returns, so a caller holding either shape
 * just needs to map players down to their `id`s first.
 */

import { pairKey, collectCoveragePairs } from './season-schedule';

export interface DraftScheduleMatch {
  match_number: number;
  shirts: [number, number];
  skins: [number, number];
}

export interface DraftScheduleWeek {
  week_number: number;
  bye_player_id: number | null;
  matches: DraftScheduleMatch[];
}

export interface ValidationIssue {
  week_number: number;
  /** Set only for issues that belong to one specific match (self-paired match, duplicate
   * match_number) — lets a UI place the issue inline next to that match rather than only in a
   * week- or draft-level list. Absent for issues that span a whole week (duplicate week_number, a
   * player over-appearing, a bye conflict) since those don't belong to any one match. */
  match_number?: number;
  message: string;
}

export interface IntegrityResult {
  ok: boolean;
  issues: ValidationIssue[];
}

/** Structural soundness only — not "does this look like a good schedule" (that's
 * `validateDraftCompleteness()`'s job). Checks, per week: every match's 4 players are distinct, no
 * player appears in more than 2 matches (2 = a legitimate doubleheader, 3+ isn't), the bye player
 * (if any) doesn't also appear in a match, `match_number`s are unique, and `week_number`s are
 * unique across the whole draft. */
export function validateDraftIntegrity(weeks: DraftScheduleWeek[]): IntegrityResult {
  const issues: ValidationIssue[] = [];
  const seenWeekNumbers = new Set<number>();

  for (const week of weeks) {
    if (seenWeekNumbers.has(week.week_number)) {
      issues.push({ week_number: week.week_number, message: `Week ${week.week_number} appears more than once` });
    }
    seenWeekNumbers.add(week.week_number);

    const seenMatchNumbers = new Set<number>();
    const appearances = new Map<number, number>();

    for (const m of week.matches) {
      if (seenMatchNumbers.has(m.match_number)) {
        issues.push({
          week_number: week.week_number,
          match_number: m.match_number,
          message: `Match ${m.match_number} appears more than once in week ${week.week_number}`,
        });
      }
      seenMatchNumbers.add(m.match_number);

      const slots = [...m.shirts, ...m.skins];
      if (new Set(slots).size !== 4) {
        issues.push({
          week_number: week.week_number,
          match_number: m.match_number,
          message: `Week ${week.week_number} match ${m.match_number}: all 4 players must be distinct`,
        });
      }
      for (const id of slots) appearances.set(id, (appearances.get(id) ?? 0) + 1);
    }

    for (const [playerId, count] of appearances) {
      if (count > 2) {
        issues.push({
          week_number: week.week_number,
          message: `Week ${week.week_number}: player ${playerId} appears in ${count} matches (2 max, for a doubleheader)`,
        });
      }
    }

    if (week.bye_player_id != null && appearances.has(week.bye_player_id)) {
      issues.push({
        week_number: week.week_number,
        message: `Week ${week.week_number}: player ${week.bye_player_id} is marked as the bye but also appears in a match`,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

export interface CompletenessResult {
  complete: boolean;
  missingTeammatePairs: [number, number][];
  missingOpponentPairs: [number, number][];
}

/** Every roster pair must play together at least once *and* against each other at least once —
 * the same two coverage requirements `buildSeasonSchedule()` guarantees for a freshly generated
 * draft, re-checked here because a hand-edit can break either one. Reports every pair still
 * missing each way (not just a yes/no), so the editor can show specifically what's left. */
export function validateDraftCompleteness(weeks: DraftScheduleWeek[], rosterPlayerIds: number[]): CompletenessResult {
  const { teammatePairs, opponentPairs } = collectCoveragePairs(weeks.flatMap((w) => w.matches));

  const missingTeammatePairs: [number, number][] = [];
  const missingOpponentPairs: [number, number][] = [];
  for (let i = 0; i < rosterPlayerIds.length; i++) {
    for (let j = i + 1; j < rosterPlayerIds.length; j++) {
      const a = rosterPlayerIds[i];
      const b = rosterPlayerIds[j];
      if (!teammatePairs.has(pairKey(a, b))) missingTeammatePairs.push([a, b]);
      if (!opponentPairs.has(pairKey(a, b))) missingOpponentPairs.push([a, b]);
    }
  }

  return {
    complete: missingTeammatePairs.length === 0 && missingOpponentPairs.length === 0,
    missingTeammatePairs,
    missingOpponentPairs,
  };
}
