/**
 * Pure model behind the Gauntlet Preview tool (`/tools/gauntlet-preview`): turns a qualifier count
 * (and, optionally, a regular season's standings) into the bracket, the seed summary and the seed
 * names the page shows. The bracket itself is `buildGauntletBracket()` rendered through
 * `fromGeneratedPlan()` → `draftToPreviewPods()` — the path the manual pod editor uses — so the
 * preview can never drift from a real bracket; this file only adds the clamping, the seed names and
 * the per-seed summary rows around it.
 */

import {
  GAUNTLET_MAX_QUALIFIERS,
  GAUNTLET_MIN_QUALIFIERS,
  buildGauntletBracket,
  projectGauntletSeeding,
  type BracketPlan,
} from './gauntlet-bracket';
import { draftToPreviewPods, fromGeneratedPlan, groupLabel } from './gauntlet-draft';
import type { BracketPod } from './stage-types';

/** One row of a regular season's standings, in canonical-sort order (index 0 = seed 1). */
export interface PreviewStanding {
  playerId: number;
  name: string;
}

/** Keeps a qualifier count inside the range `buildGauntletBracket()` has a shape for. */
export function clampQualifierCount(count: number): number {
  return Math.min(GAUNTLET_MAX_QUALIFIERS, Math.max(GAUNTLET_MIN_QUALIFIERS, Math.round(count)));
}

/** The qualifier count a standings list would produce today — one qualifier per player, as
 *  `tryBuildGauntletShape()` builds it — clamped to the supported range. */
export function qualifierCountFor(standings: readonly PreviewStanding[]): number {
  return clampQualifierCount(standings.length);
}

/** Seed number → player name for the seeds a bracket of `qualifierCount` has, from standings in
 *  canonical-sort order. Seeds beyond the standings' length are left unnamed. */
export function seedNamesFor(standings: readonly PreviewStanding[], qualifierCount: number): Map<number, string> {
  const names = new Map<number, string>();
  standings.slice(0, qualifierCount).forEach((row, i) => names.set(i + 1, row.name));
  return names;
}

export type SeedFate = 'bye' | 'plays' | 'wontQualify';

export interface SeedSummaryRow {
  seed: number;
  /** Who holds the seed in the loaded standings; null when no season is loaded or it has fewer players. */
  name: string | null;
  fate: SeedFate;
  /** Where the seed enters the bracket: "Round 1 Group 2", "the Final", or "Not in the bracket". */
  entry: string;
}

export interface GauntletPreview {
  plan: BracketPlan;
  /** The bracket in the shape `GauntletBracketDiagram` reads. Seed slots carry no names — pass
   *  `seedNames` to the diagram, which labels them "Seed 3 (PlayerName)". */
  pods: BracketPod[];
  seedNames: Map<number, string>;
  seeds: SeedSummaryRow[];
  rounds: number;
  games: number;
}

/** Everything the Gauntlet Preview page renders for `qualifierCount` qualifiers. Throws for a count
 *  outside the supported range, like `buildGauntletBracket()` — callers clamp first. */
export function buildGauntletPreview(qualifierCount: number, standings: readonly PreviewStanding[] = []): GauntletPreview {
  const plan = buildGauntletBracket(qualifierCount);
  const pods = draftToPreviewPods(fromGeneratedPlan(plan), new Map());
  const seedNames = seedNamesFor(standings, qualifierCount);
  const placements = projectGauntletSeeding(qualifierCount)!;
  const podsByPlacement = new Map(plan.pods.map((p) => [`${p.round_number}:${p.pod_index}`, p]));

  const seeds: SeedSummaryRow[] = Array.from({ length: qualifierCount }, (_, i) => {
    const seed = i + 1;
    const placement = placements.get(seed)!;
    const name = seedNames.get(seed) ?? null;
    if (!placement.qualifies) return { seed, name, fate: 'wontQualify', entry: 'Not in the bracket' };
    const pod = podsByPlacement.get(`${placement.round}:${placement.podIndex}`)!;
    const entry = groupLabel(pod);
    return { seed, name, fate: placement.isBye ? 'bye' : 'plays', entry: entry.charAt(0).toUpperCase() + entry.slice(1) };
  });

  return {
    plan,
    pods,
    seedNames,
    seeds,
    rounds: Math.max(...plan.pods.map((p) => p.round_number)),
    games: plan.games,
  };
}
