import { allMatchesPlayed, anyMatchPlayed, weekLabel } from './util';
import { groupHref, groupName, roundHref, weekHref } from './crumbs';
import { compareRecords, deriveGroupScorecard, podAdvances, type PlayerRecord } from './group-scorecard';
import { rankMovementForWeek, type RankMovement } from './season-standings';
import { seedByPlayerId } from './gauntlet-draft';
import type { SeasonWeekNavEntry, WeekWithMatches, BracketPod, GauntletMatch, GauntletRound } from './stage-types';

// Pure derivations behind the week, round and group pages: given the data the queries return, shape
// exactly what each page renders (scorecards, outcomes, navigation). No fetching in here.

export type StageStatus = 'complete' | 'in-progress' | 'upcoming';

export const STAGE_STATUS_LABEL: Record<StageStatus, string> = {
  complete: 'Complete',
  'in-progress': 'In progress',
  upcoming: 'Upcoming',
};

/** Done once every match is played, in progress once any is, otherwise upcoming. */
export function stageStatus(matches: { final_score: string | null }[]): StageStatus {
  if (allMatchesPlayed(matches)) return 'complete';
  return anyMatchPlayed(matches) ? 'in-progress' : 'upcoming';
}

export interface StageNavItem {
  /** Chip text: "3" for Week 3, "Group 2" / "Final" for a group. */
  chip: string;
  label: string;
  /** `null` for a chip with nowhere to go. */
  href: string | null;
  /** Whether any game in this stage has been played — drives the chip's bright/dim colour. */
  played: boolean;
  current: boolean;
}

// ─── Regular-season week ─────────────────────────────────────────────────────────────────────────

export interface WeekScorecardRow extends PlayerRecord {
  /** Season-standings movement across this week. */
  movement: RankMovement | null;
}

export interface WeekView {
  week: WeekWithMatches;
  status: StageStatus;
  scorecard: WeekScorecardRow[];
  /** One chip per week of the season. */
  nav: StageNavItem[];
}

/** A week's own records, best first. The week's bye player sits on it too, last and with nothing
 *  played: their season rank can still move as everyone else's results land. */
function deriveWeekScorecard(week: WeekWithMatches): PlayerRecord[] {
  const bye = week.bye_player_id != null ? [{ player_id: week.bye_player_id, player_name: week.bye_player_name ?? `#${week.bye_player_id}` }] : [];
  return deriveGroupScorecard(week.matches, 'wins', bye);
}

/** What a week's Open Graph image shows: the week itself, with no standings movement or navigation,
 *  so it needs no other week's data. */
export interface WeekSummary {
  week: WeekWithMatches;
  status: StageStatus;
  scorecard: PlayerRecord[];
}

export function deriveWeekSummary(week: WeekWithMatches): WeekSummary {
  return { week, status: stageStatus(week.matches), scorecard: deriveWeekScorecard(week) };
}

/**
 * `schedule` is the season's weeks up to and including the one being viewed, with full rosters
 * (everything the scorecard and standings need); `navWeeks` is every week of the season, light, for
 * the chip strip. Standings are cumulative, so movement needs each earlier week, but nothing after
 * this one. Week 1 has nothing to move from, so it carries no movement.
 */
export function deriveWeekView(
  hubSeasonId: number,
  schedule: WeekWithMatches[],
  navWeeks: SeasonWeekNavEntry[],
  weekId: number,
): WeekView | null {
  const week = schedule.find((w) => w.id === weekId);
  if (!week) return null;

  const movement = week.week_number > 1 ? rankMovementForWeek(schedule, week.week_number) : new Map<number, RankMovement>();
  const scorecard = deriveWeekScorecard(week).map((r) => ({ ...r, movement: movement.get(r.player_id) ?? null }));

  const items = navWeeks.map<StageNavItem>((w) => ({
    chip: String(w.week_number),
    label: weekLabel(w.week_number, false),
    href: weekHref(hubSeasonId, w.id),
    played: anyMatchPlayed(w.matches),
    current: w.id === weekId,
  }));
  return { week, status: stageStatus(week.matches), scorecard, nav: items };
}

// ─── Gauntlet round / group ──────────────────────────────────────────────────────────────────────

/** What a finished pod means for a player; `pending` until every game in the pod is played. */
export type GroupOutcome = 'advances' | 'eliminated' | 'pending';

export interface GroupRow extends PlayerRecord {
  /** 1-indexed place in the group once any game is played, else `null`. */
  rank: number | null;
  /** The player's original tournament seed, when known. */
  seed: number | null;
  outcome: GroupOutcome;
}

export interface GroupView {
  /** `null` only for a legacy gauntlet match with no pod behind it. */
  pod: BracketPod | null;
  /** "Group 2" / "Final"; `null` for a legacy pod-less match. */
  label: string | null;
  isFinal: boolean;
  advanceRule: 'single' | 'wildcard' | null;
  status: StageStatus;
  /** Real games, in game order. Empty while the pod is still waiting on its bracket. */
  matches: GauntletMatch[];
  scorecard: GroupRow[];
}

export interface GauntletStageData {
  rounds: GauntletRound[];
  bracketShape: BracketPod[];
}

function buildGroupView(matches: GauntletMatch[], pod: BracketPod | null, seeds: Map<number, number>): GroupView {
  const isFinal = pod?.is_final ?? false;
  const advanceRule = pod?.advance_rule ?? null;
  const ordered = [...matches].sort((a, b) => a.match_number - b.match_number);
  const complete = allMatchesPlayed(ordered);

  // Everyone in the group: the real games' rosters once they exist, else the pod's resolved slots.
  const occupants = new Map<number, string>();
  for (const m of ordered) for (const p of [...m.shirts_stats, ...m.skins_stats]) occupants.set(p.player_id, p.player_name);
  if (occupants.size === 0 && pod) {
    for (const s of pod.slots) if (s.player_id != null) occupants.set(s.player_id, s.player_name ?? `#${s.player_id}`);
  }

  const anyPlayed = anyMatchPlayed(ordered);
  const rank = compareRecords('win_rate');
  const seedOf = (id: number) => seeds.get(id) ?? Infinity;
  const roster = [...occupants].map(([player_id, player_name]) => ({ player_id, player_name }));
  // Played ranking is the canonical gauntlet order; exact ties (and an unplayed pod) fall back to seed.
  const sorted = deriveGroupScorecard(ordered, 'win_rate', roster).sort(
    (a, b) => (anyPlayed ? rank(a, b) : 0) || seedOf(a.player_id) - seedOf(b.player_id),
  );

  const scorecard = sorted.map<GroupRow>((r, i) => ({
    ...r,
    rank: anyPlayed ? i + 1 : null,
    seed: seeds.get(r.player_id) ?? null,
    outcome:
      complete && advanceRule && !isFinal
        ? podAdvances(advanceRule, r.wins, ordered.length)
          ? 'advances'
          : 'eliminated'
        : 'pending',
  }));

  return {
    pod,
    label: pod ? groupName(pod.pod_index, pod.is_final) : null,
    isFinal,
    advanceRule,
    status: stageStatus(ordered),
    matches: ordered,
    scorecard,
  };
}

/** A round's groups in pod order: one per bracket pod (materialized or not), plus a standalone
 *  entry per legacy pod-less match. */
function groupsOfRound(data: GauntletStageData, roundNumber: number, seeds: Map<number, number>): GroupView[] {
  const round = data.rounds.find((r) => r.round_number === roundNumber);
  const matches = round?.matches ?? [];
  const pods = data.bracketShape.filter((p) => p.round_number === roundNumber).sort((a, b) => a.pod_index - b.pod_index);

  const groups = pods.map((pod) =>
    buildGroupView(
      matches.filter((m) => m.pod_index === pod.pod_index),
      pod,
      seeds,
    ),
  );
  for (const m of matches) {
    if (m.pod_index == null) groups.push(buildGroupView([m], null, seeds));
  }
  return groups;
}

export interface RoundView {
  roundNumber: number;
  isFinal: boolean;
  status: StageStatus;
  groups: GroupView[];
  /** One chip per round of the gauntlet. */
  nav: StageNavItem[];
}

function roundNumbersOf(data: GauntletStageData): number[] {
  return [...new Set([...data.rounds.map((r) => r.round_number), ...data.bracketShape.map((p) => p.round_number)])].sort((a, b) => a - b);
}

/** Every original tournament seed in the bracket, by player. */
function bracketSeeds(data: GauntletStageData): Map<number, number> {
  return seedByPlayerId(data.bracketShape.flatMap((p) => p.slots));
}

export function deriveRoundView(hubSeasonId: number, data: GauntletStageData, roundNumber: number): RoundView | null {
  const roundNumbers = roundNumbersOf(data);
  if (!roundNumbers.includes(roundNumber)) return null;

  const groups = groupsOfRound(data, roundNumber, bracketSeeds(data));
  const items = roundNumbers.map<StageNavItem>((n) => ({
    chip: String(n),
    label: weekLabel(n, true),
    href: roundHref(hubSeasonId, n),
    played: anyMatchPlayed(data.rounds.find((r) => r.round_number === n)?.matches ?? []),
    current: n === roundNumber,
  }));
  const matches = groups.flatMap((g) => g.matches);
  return {
    roundNumber,
    isFinal: groups.some((g) => g.isFinal),
    status: stageStatus(matches),
    groups,
    nav: items,
  };
}

export interface GroupPageView {
  group: GroupView & { pod: BracketPod };
  roundNumber: number;
  /** One chip per group of this group's round. */
  nav: StageNavItem[];
}

export function deriveGroupPageView(hubSeasonId: number, data: GauntletStageData, podId: number): GroupPageView | null {
  const pod = data.bracketShape.find((p) => p.id === podId);
  if (!pod) return null;
  const groups = groupsOfRound(data, pod.round_number, bracketSeeds(data));
  const found = groups.find((g) => g.pod?.id === podId);
  if (!found) return null;

  const nav = groups.map<StageNavItem>((g) => ({
    chip: g.label ?? '•',
    label: g.label ?? 'Game',
    href: g.pod ? groupHref(hubSeasonId, g.pod.id) : null,
    played: anyMatchPlayed(g.matches),
    current: g.pod?.id === podId,
  }));
  return { group: { ...found, pod }, roundNumber: pod.round_number, nav };
}
