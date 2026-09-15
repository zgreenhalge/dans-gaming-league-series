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
import type { BracketPod, GauntletRound } from '@/lib/queries';

function bracketPod(overrides: Partial<BracketPod> & { id: number }): BracketPod {
  return {
    round_number: 1,
    pod_index: 0,
    advance_rule: 'wildcard',
    is_final: false,
    played: false,
    materialized: false,
    slots: [],
    ...overrides,
  };
}

const round2: GauntletRound = { round_number: 2, matches: [], is_final_round: false };

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

    expect(screen.getByText('Winner of Round 1 Group 1')).toBeInTheDocument();
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
});
