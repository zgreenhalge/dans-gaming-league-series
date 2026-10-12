import { allMatchesPlayed, anyMatchPlayed, GAUNTLET_POD_STAKES_LABEL } from './util';
import { groupHref, groupLabel, roundHref, weekHref, weekLabel } from './crumbs';
import {
  aggregatePlayerRecords,
  compareRecords,
  emptyRecord,
  podAdvances,
  type PlayerRecord,
} from './group-scorecard';
import { rankMovementForWeek, type RankMovement } from './season-standings';
import { seedByPlayerId } from './gauntlet-draft';
import type { WeekWithMatches } from './queries/schedule';
import type { BracketPod, GauntletMatch, GauntletRound } from './queries/gauntlet';

// Pure derivations behind the week, round and group pages: given the data the queries return, shape
// exactly what each page renders (scorecards, outcomes, navigation). No fetching in here.

export type StageStatus = 'complete' | 'in-progress' | 'upcoming';

/** Done once every match is played, in progress once any is, otherwise upcoming. */
export function stageStatus(matches: { final_score: string | null }[]): StageStatus {
  if (allMatchesPlayed(matches)) return 'complete';
  return anyMatchPlayed(matches) ? 'in-progress' : 'upcoming';
}

export interface StageNavItem {
  /** Short chip text: "3" for Week 3, "G2" for Group 2. */
  chip: string;
  label: string;
  /** `null` when the stage has no page of its own yet (a round whose week row isn't created). */
  href: string | null;
  status: StageStatus;
  current: boolean;
}

export interface StageNav {
  items: StageNavItem[];
  prev: StageNavItem | null;
  next: StageNavItem | null;
}

/** Items plus the nearest linkable neighbours of the current one. */
function buildNav(items: StageNavItem[]): StageNav {
  const at = items.findIndex((i) => i.current);
  const prev = at > 0 ? ([...items.slice(0, at)].reverse().find((i) => i.href != null) ?? null) : null;
  const next = at >= 0 ? (items.slice(at + 1).find((i) => i.href != null) ?? null) : null;
  return { items, prev, next };
}

// ─── Regular-season week ─────────────────────────────────────────────────────────────────────────

export interface WeekScorecardRow extends PlayerRecord {
  /** 1-indexed place within this week, by the canonical regular-season sort. */
  rank: number;
  /** Season-standings movement across this week. */
  movement: RankMovement | null;
}

export interface WeekView {
  week: WeekWithMatches;
  status: StageStatus;
  scorecard: WeekScorecardRow[];
  nav: StageNav;
}

export function deriveWeekView(hubSeasonId: number, schedule: WeekWithMatches[], weekId: number): WeekView | null {
  const week = schedule.find((w) => w.id === weekId);
  if (!week) return null;

  const movement = rankMovementForWeek(schedule, week.week_number);
  const scorecard = [...aggregatePlayerRecords(week.matches).values()]
    .sort(compareRecords('wins'))
    .map((r, i) => ({ ...r, rank: i + 1, movement: movement.get(r.player_id) ?? null }));

  const items = schedule.map<StageNavItem>((w) => ({
    chip: String(w.week_number),
    label: weekLabel(w.week_number, false),
    href: weekHref(hubSeasonId, w.id),
    status: stageStatus(w.matches),
    current: w.id === weekId,
  }));
  return { week, status: stageStatus(week.matches), scorecard, nav: buildNav(items) };
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
  podIndex: number | null;
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
  /** `weeks.id` for each round that has a week row. */
  weekIdByRound: Map<number, number>;
}

function buildGroupView(matches: GauntletMatch[], pod: BracketPod | null, seeds: Map<number, number>): GroupView {
  const isFinal = pod?.is_final ?? false;
  const advanceRule = pod?.advance_rule ?? null;
  const ordered = [...matches].sort((a, b) => a.match_number - b.match_number);
  const complete = allMatchesPlayed(ordered);
  const records = aggregatePlayerRecords(ordered);

  // Everyone in the group: the real games' rosters once they exist, else the pod's resolved slots.
  const occupants = new Map<number, string>();
  for (const m of ordered) for (const p of [...m.shirts_stats, ...m.skins_stats]) occupants.set(p.player_id, p.player_name);
  if (occupants.size === 0 && pod) {
    for (const s of pod.slots) if (s.player_id != null) occupants.set(s.player_id, s.player_name ?? `#${s.player_id}`);
  }

  const anyPlayed = anyMatchPlayed(ordered);
  const rank = compareRecords('win_rate');
  const seedOf = (id: number) => seeds.get(id) ?? Infinity;
  const sorted = [...occupants]
    .map(([id, name]) => records.get(id) ?? emptyRecord(id, name))
    // Played ranking is the canonical gauntlet order; exact ties (and an unplayed pod) fall back to seed.
    .sort((a, b) => (anyPlayed ? rank(a, b) : 0) || seedOf(a.player_id) - seedOf(b.player_id));

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
    podIndex: pod?.pod_index ?? matches[0]?.pod_index ?? null,
    label: pod ? groupLabel(pod.pod_index, pod.is_final) : null,
    isFinal,
    advanceRule,
    status: stageStatus(ordered),
    matches: ordered,
    scorecard,
  };
}

/** A round's groups in pod order: one per bracket pod (materialized or not), plus a standalone
 *  entry per legacy pod-less match. */
function groupsOfRound(data: GauntletStageData, roundNumber: number): GroupView[] {
  const seeds = seedByPlayerId(data.bracketShape.flatMap((p) => p.slots));
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
  weekId: number | null;
  isFinal: boolean;
  status: StageStatus;
  groups: GroupView[];
  nav: StageNav;
}

function roundNumbersOf(data: GauntletStageData): number[] {
  return [...new Set([...data.rounds.map((r) => r.round_number), ...data.bracketShape.map((p) => p.round_number)])].sort((a, b) => a - b);
}

export function deriveRoundView(hubSeasonId: number, data: GauntletStageData, weekId: number): RoundView | null {
  const roundNumber = [...data.weekIdByRound].find(([, id]) => id === weekId)?.[0];
  if (roundNumber == null) return null;

  const groups = groupsOfRound(data, roundNumber);
  const items = roundNumbersOf(data).map<StageNavItem>((n) => {
    const id = data.weekIdByRound.get(n) ?? null;
    return {
      chip: String(n),
      label: weekLabel(n, true),
      href: id != null ? roundHref(hubSeasonId, id) : null,
      status: stageStatus(data.rounds.find((r) => r.round_number === n)?.matches ?? []),
      current: n === roundNumber,
    };
  });
  const matches = groups.flatMap((g) => g.matches);
  return {
    roundNumber,
    weekId,
    isFinal: groups.some((g) => g.isFinal),
    status: stageStatus(matches),
    groups,
    nav: buildNav(items),
  };
}

export interface GroupPageView {
  group: GroupView;
  roundNumber: number;
  /** The round's `weeks.id`, `null` while the round has no week row. */
  weekId: number | null;
  /** Chips for the groups of this group's round. */
  nav: StageNav;
  /** Previous/next group across the whole bracket (round, then pod order). */
  prev: StageNavItem | null;
  next: StageNavItem | null;
}

export function deriveGroupPageView(hubSeasonId: number, data: GauntletStageData, podId: number): GroupPageView | null {
  const pod = data.bracketShape.find((p) => p.id === podId);
  if (!pod) return null;
  const groups = groupsOfRound(data, pod.round_number);
  const group = groups.find((g) => g.pod?.id === podId);
  if (!group) return null;

  const itemOf = (g: GroupView, current: boolean): StageNavItem => ({
    chip: g.isFinal ? 'F' : `G${(g.podIndex ?? 0) + 1}`,
    label: g.label ?? 'Game',
    href: g.pod ? groupHref(hubSeasonId, g.pod.id) : null,
    status: g.status,
    current,
  });

  // Bracket order across rounds for prev/next.
  const ordered = [...data.bracketShape].sort((a, b) => a.round_number - b.round_number || a.pod_index - b.pod_index);
  const at = ordered.findIndex((p) => p.id === podId);
  const neighbour = (p: BracketPod | undefined): StageNavItem | null => {
    if (!p) return null;
    const g = groupsOfRound(data, p.round_number).find((x) => x.pod?.id === p.id);
    return g ? { ...itemOf(g, false), label: `${weekLabel(p.round_number, true)} · ${g.label}` } : null;
  };

  return {
    group,
    roundNumber: pod.round_number,
    weekId: data.weekIdByRound.get(pod.round_number) ?? null,
    nav: buildNav(groups.map((g) => itemOf(g, g.pod?.id === podId))),
    prev: neighbour(ordered[at - 1]),
    next: neighbour(ordered[at + 1]),
  };
}

const GROUP_RANK_RULE = 'Ranked by win rate → RWR% → ADR.';

/** The scorecard caption for a group: its stakes, then the rule the rows are ordered by. */
export function groupCaption(group: Pick<GroupView, 'isFinal' | 'advanceRule'>): string {
  if (group.isFinal) return `Final — places are decided by record, then RWR%, then ADR.`;
  if (group.advanceRule) return `${GAUNTLET_POD_STAKES_LABEL[group.advanceRule]} ${GROUP_RANK_RULE}`;
  return GROUP_RANK_RULE;
}
