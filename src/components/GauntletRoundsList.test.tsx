// @vitest-environment jsdom
/**
 * Component tests for the Schedule tab's placeholder rows for not-yet-materialized pods (#528):
 * `GauntletRoundsList` merges `bracketShape` (the full, unmaterialized-included bracket shape) in
 * alongside the real, played-or-scheduled `matches` a round already has, so a round with a pending
 * pod shows *something* instead of silently omitting it.
 *
 * Run:  npx vitest run src/components/GauntletRoundsList.test.tsx
 */

import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import GauntletRoundsList from './GauntletRoundsList';
import type { GauntletMatch, GauntletRound } from '@/lib/queries';
import { bracketPod } from '@/lib/test-support/gauntletFixtures';

const round2: GauntletRound = { round_number: 2, matches: [], is_final_round: false };

function gauntletMatch(overrides: Partial<GauntletMatch> & { id: number }): GauntletMatch {
  return {
    match_number: 1,
    final_score: null,
    scheduled_at: null,
    picked_map: null,
    shirts_pick: null,
    skins_starting_side: null,
    is_feature_match: false,
    shirts_stats: [],
    skins_stats: [],
    pod_index: null,
    advance_rule: null,
    ...overrides,
  };
}

describe('GauntletRoundsList — pending pod placeholders (#528)', () => {
  test('a pending pod with only seed slots shows a "Not yet scheduled" placeholder naming each seed', () => {
    const pod = bracketPod({
      id: 27,
      round_number: 2,
      pod_index: 1,
      advance_rule: 'single',
      slots: [
        { slot_index: 0, source_kind: 'seed', source_seed: 1, source_pod_id: null, player_id: null, player_name: null },
        { slot_index: 1, source_kind: 'seed', source_seed: 4, source_pod_id: null, player_id: null, player_name: null },
      ],
    });

    render(
      <GauntletRoundsList
        displayRounds={[round2]}
        allRounds={[round2]}
        bracketShape={[pod]}
        openRounds={new Set([2])}
        onToggleRound={() => {}}
        currentPlayerId={null}
      />,
    );

    expect(screen.getByText('Not yet scheduled')).toBeInTheDocument();
    expect(screen.getByText('Seed 1')).toBeInTheDocument();
    expect(screen.getByText('Seed 4')).toBeInTheDocument();
  });

  test('a pending slot fed by an earlier pod names that pod instead of a bare "TBD"', () => {
    const feeder = bracketPod({ id: 10, round_number: 1, pod_index: 0, advance_rule: 'single' });
    const pod = bracketPod({
      id: 27,
      round_number: 2,
      pod_index: 1,
      advance_rule: 'single',
      slots: [
        { slot_index: 0, source_kind: 'pod', source_seed: null, source_pod_id: 10, player_id: null, player_name: null },
      ],
    });

    render(
      <GauntletRoundsList
        displayRounds={[round2]}
        allRounds={[round2]}
        bracketShape={[feeder, pod]}
        openRounds={new Set([2])}
        onToggleRound={() => {}}
        currentPlayerId={null}
      />,
    );

    expect(screen.getByText('Round 1 Group 1 Winner')).toBeInTheDocument();
    expect(screen.queryByText('TBD')).not.toBeInTheDocument();
  });

  test('a pending slot that already has a resolved player_id shows the player name', () => {
    const pod = bracketPod({
      id: 27,
      round_number: 2,
      pod_index: 1,
      advance_rule: 'single',
      slots: [
        { slot_index: 0, source_kind: 'pod', source_seed: null, source_pod_id: 10, player_id: 5, player_name: 'Nova' },
      ],
    });

    render(
      <GauntletRoundsList
        displayRounds={[round2]}
        allRounds={[round2]}
        bracketShape={[pod]}
        openRounds={new Set([2])}
        onToggleRound={() => {}}
        currentPlayerId={null}
      />,
    );

    expect(screen.getByText('Nova')).toBeInTheDocument();
  });

  test('myGamesOnly hides a pending pod none of whose resolved slots are the current player', () => {
    const podMine = bracketPod({
      id: 27,
      round_number: 2,
      pod_index: 0,
      advance_rule: 'single',
      slots: [{ slot_index: 0, source_kind: 'seed', source_seed: 1, source_pod_id: null, player_id: 5, player_name: 'Nova' }],
    });
    const podNotMine = bracketPod({
      id: 28,
      round_number: 2,
      pod_index: 1,
      advance_rule: 'single',
      slots: [{ slot_index: 0, source_kind: 'seed', source_seed: 2, source_pod_id: null, player_id: 6, player_name: 'Rex' }],
    });

    render(
      <GauntletRoundsList
        displayRounds={[round2]}
        allRounds={[round2]}
        bracketShape={[podMine, podNotMine]}
        myGamesOnly
        openRounds={new Set([2])}
        onToggleRound={() => {}}
        currentPlayerId={5}
      />,
    );

    expect(screen.getByText('Nova')).toBeInTheDocument();
    expect(screen.queryByText('Rex')).not.toBeInTheDocument();
  });

  test('myGamesOnly still shows a pending pod with no resolved slots at all — it might yet be mine', () => {
    const unresolved = bracketPod({
      id: 30,
      round_number: 2,
      pod_index: 0,
      advance_rule: 'single',
      slots: [
        { slot_index: 0, source_kind: 'pod', source_seed: null, source_pod_id: 10, player_id: null, player_name: null },
        { slot_index: 1, source_kind: 'pod', source_seed: null, source_pod_id: 11, player_id: null, player_name: null },
      ],
    });

    render(
      <GauntletRoundsList
        displayRounds={[round2]}
        allRounds={[round2]}
        bracketShape={[unresolved]}
        myGamesOnly
        openRounds={new Set([2])}
        onToggleRound={() => {}}
        currentPlayerId={5}
      />,
    );

    expect(screen.getByText('Not yet scheduled')).toBeInTheDocument();
  });

  test('the placeholder only renders once the round is expanded', () => {
    const pod = bracketPod({
      id: 27,
      round_number: 2,
      pod_index: 1,
      advance_rule: 'single',
      slots: [{ slot_index: 0, source_kind: 'seed', source_seed: 1, source_pod_id: null, player_id: null, player_name: null }],
    });

    render(
      <GauntletRoundsList
        displayRounds={[round2]}
        allRounds={[round2]}
        bracketShape={[pod]}
        openRounds={new Set()}
        onToggleRound={() => {}}
        currentPlayerId={null}
      />,
    );

    expect(screen.queryByText('Not yet scheduled')).not.toBeInTheDocument();
  });

  test('a pod always shows its "Group N" label, even when its stakes are hoisted to the round header', () => {
    const pod = bracketPod({
      id: 27,
      round_number: 2,
      pod_index: 1,
      advance_rule: 'single',
      slots: [{ slot_index: 0, source_kind: 'seed', source_seed: 1, source_pod_id: null, player_id: null, player_name: null }],
    });

    render(
      <GauntletRoundsList
        displayRounds={[round2]}
        allRounds={[round2]}
        bracketShape={[pod]}
        openRounds={new Set([2])}
        onToggleRound={() => {}}
        currentPlayerId={null}
      />,
    );

    // A round with only one materialized-or-pending pod always hoists its stakes to the round
    // header (podRules.size === 1) — the pod's own "Group 2" identity must still show regardless.
    expect(screen.getByText('Group 2')).toBeInTheDocument();
  });

  test('two pods in the same round each number their own games Game 1/Game 2, not a running count', () => {
    const podA: GauntletMatch[] = [
      gauntletMatch({ id: 101, match_number: 1, pod_index: 0, advance_rule: 'single' }),
      gauntletMatch({ id: 102, match_number: 2, pod_index: 0, advance_rule: 'single' }),
    ];
    const podB: GauntletMatch[] = [
      gauntletMatch({ id: 103, match_number: 1, pod_index: 1, advance_rule: 'single' }),
      gauntletMatch({ id: 104, match_number: 2, pod_index: 1, advance_rule: 'single' }),
    ];
    const round: GauntletRound = { round_number: 2, matches: [...podA, ...podB], is_final_round: false };

    render(
      <GauntletRoundsList
        displayRounds={[round]}
        allRounds={[round]}
        bracketShape={[]}
        openRounds={new Set([2])}
        onToggleRound={() => {}}
        currentPlayerId={null}
      />,
    );

    expect(screen.getByText('Group 1')).toBeInTheDocument();
    expect(screen.getByText('Group 2')).toBeInTheDocument();
    expect(screen.getAllByText('Game 1')).toHaveLength(2);
    expect(screen.getAllByText('Game 2')).toHaveLength(2);
    expect(screen.queryByText('Game 3')).not.toBeInTheDocument();
  });

  test('a game flagged is_feature_match shows the feature icon, same as a regular-season match', () => {
    const round: GauntletRound = {
      round_number: 1,
      matches: [gauntletMatch({ id: 302, match_number: 1, is_feature_match: true })],
      is_final_round: false,
    };

    render(
      <GauntletRoundsList
        displayRounds={[round]}
        allRounds={[round]}
        bracketShape={[]}
        openRounds={new Set([1])}
        onToggleRound={() => {}}
        currentPlayerId={null}
      />,
    );

    expect(screen.getByText('⭐')).toBeInTheDocument();
  });

  test('an unplayed match with scheduled_at shows the scheduled time instead of "Pending"', () => {
    const round: GauntletRound = {
      round_number: 1,
      matches: [gauntletMatch({ id: 301, match_number: 1, scheduled_at: '2026-01-15T18:00:00Z' })],
      is_final_round: false,
    };

    render(
      <GauntletRoundsList
        displayRounds={[round]}
        allRounds={[round]}
        bracketShape={[]}
        openRounds={new Set([1])}
        onToggleRound={() => {}}
        currentPlayerId={null}
      />,
    );

    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
    expect(screen.getByText(/Jan 15/)).toBeInTheDocument();
  });

  test('legacy pod-less matches (no gauntlet_pods data) keep one continuous Game N count across the round', () => {
    // pod_index null throughout — a gauntlet predating bracket scheduling. Each match stands alone
    // (no Group label), and per-pod numbering must not reset it to "Game 1" three times over.
    const round: GauntletRound = {
      round_number: 1,
      matches: [
        gauntletMatch({ id: 201, match_number: 1 }),
        gauntletMatch({ id: 202, match_number: 2 }),
        gauntletMatch({ id: 203, match_number: 3 }),
      ],
      is_final_round: false,
    };

    render(
      <GauntletRoundsList
        displayRounds={[round]}
        allRounds={[round]}
        bracketShape={[]}
        openRounds={new Set([1])}
        onToggleRound={() => {}}
        currentPlayerId={null}
      />,
    );

    expect(screen.getByText('Game 1')).toBeInTheDocument();
    expect(screen.getByText('Game 2')).toBeInTheDocument();
    expect(screen.getByText('Game 3')).toBeInTheDocument();
    expect(screen.queryByText(/^Group \d/)).not.toBeInTheDocument();
  });
});
