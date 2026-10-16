// Shapes of the week, round and group pages' data: the schedule and gauntlet-bracket rows that
// `src/lib/queries/{schedule,gauntlet}.ts` return and the pure view-shaping modules
// (`stage-views.ts`, `gauntlet-draft.ts`, `discord-threads.ts`) consume. Defined here so both layers
// import them from one place; `queries/` re-exports each so `import { X } from '@/lib/queries'`
// still resolves.

import type { Faction, Match, Week } from './types';

export interface RosterStat {
  match_id: number;
  player_id: number;
  player_name: string;
  faction: Faction;
  kills: number;
  assists: number;
  deaths: number;
  adr: number;
  /** Raw `player_match_stats.damage` — distinct from `adr` (a rounded per-match average); what a
   *  true aggregate ADR (`total_damage / total_rounds_played`) is built from. */
  damage: number;
  is_win: boolean;
  rounds_won: number;
  rounds_played: number;
}

export interface MatchWithRoster extends Match {
  shirts: { player_id: number; player_name: string }[];
  skins: { player_id: number; player_name: string }[];
  shirts_stats: RosterStat[];
  skins_stats: RosterStat[];
}

export interface WeekWithMatches extends Week {
  bye_player_name: string | null;
  matches: MatchWithRoster[];
}

export interface SeasonWeekNavEntry {
  id: number;
  week_number: number;
  matches: { final_score: string | null }[];
}

export interface GauntletPlayerStat {
  player_id: number;
  player_name: string;
  faction: 'SHIRTS' | 'SKINS';
  kills: number;
  assists: number;
  deaths: number;
  adr: number;
  /** Raw `player_match_stats.damage` — distinct from `adr` (a rounded per-match average): needed to
   *  re-derive a true (unrounded) `total_damage`-based aggregate, e.g. `deriveGauntletSeasonLeaderboard()`. */
  damage: number;
  is_win: boolean;
  rounds_won: number;
  rounds_played: number;
}

export interface GauntletMatch {
  id: number;
  match_number: number;
  final_score: string | null;
  scheduled_at: string | null;
  skins_pick: string | null;
  shirts_pick: string | null;
  skins_starting_side: 'CT' | 'T' | null;
  is_feature_match: boolean;
  shirts_stats: GauntletPlayerStat[];
  skins_stats: GauntletPlayerStat[];
  /** The pod this match belongs to — null for gauntlets predating the bracket-scheduling feature
   * (historical CSV imports), which have no `gauntlet_pods` rows at all. */
  pod_index: number | null;
  advance_rule: 'single' | 'wildcard' | null;
}

export interface GauntletRound {
  round_number: number;
  matches: GauntletMatch[];
  /** True when this round is the bracket's actual final — sourced from `gauntlet_pods.is_final`,
   * not from "the highest round_number with matches scheduled so far." A gauntlet's true final
   * round can still be unmaterialized (no week/matches yet) while an earlier round is fully
   * scheduled, so inferring "final" from the max round_number among returned rounds mislabels that
   * earlier round as the final. Legacy CSV-imported gauntlets (no `gauntlet_pods` rows at all) fall
   * back to that max-round_number heuristic, since they have no pod data to read `is_final` from. */
  is_final_round: boolean;
}

export interface BracketSlot {
  slot_index: number;
  source_kind: 'seed' | 'pod';
  /** The initial tournament seed this slot is filled from, once assigned — set only for
   * `source_kind = 'seed'` slots, and only for the round they first appear in (round 1, or later
   * for a bye). */
  source_seed: number | null;
  /** The earlier pod this slot's occupant advances from — set only for `source_kind = 'pod'`
   * slots. Draws the connector line between pods in `GauntletBracketDiagram`. */
  source_pod_id: number | null;
  player_id: number | null;
  player_name: string | null;
}

export interface BracketPod {
  id: number;
  round_number: number;
  pod_index: number;
  advance_rule: 'single' | 'wildcard';
  is_final: boolean;
  /** True once every match this pod has materialized is played. False for an unmaterialized pod
   * (no matches yet) as well as one still in progress. */
  played: boolean;
  /** True once this pod's matches exist (`match1_id` set), whether or not they're played yet — the
   * manual pod editor (`GauntletPodEditor`) locks a pod against further editing/deletion from this
   * point on, since its scheduling is real. */
  materialized: boolean;
  slots: BracketSlot[];
}
