import { describe, it, expect } from 'vitest';
import { withEnemyDamage } from './parseDemo';
import type { ParsedDemoResult } from '../demoParser';
import type { ParsedDemoSabremetricsResult, SabFields } from '../types';

function parsed(stats: { player_id: number; damage: number; rounds_played: number }[]): ParsedDemoResult {
  return { stats: stats.map((s) => ({ ...s, adr: 0 })) } as unknown as ParsedDemoResult;
}

function sab(rows: { player_id: number; damage_ct: number; damage_t: number }[]): ParsedDemoSabremetricsResult {
  return {
    sabremetrics: rows.map((r) => ({
      player_id: r.player_id,
      sabremetrics: { damage_ct: r.damage_ct, damage_t: r.damage_t } as SabFields,
    })),
  } as unknown as ParsedDemoSabremetricsResult;
}

describe('withEnemyDamage', () => {
  it('replaces the engine damage with damage_ct + damage_t and recomputes ADR', () => {
    const result = withEnemyDamage(
      parsed([{ player_id: 1, damage: 2067, rounds_played: 24 }]),
      sab([{ player_id: 1, damage_ct: 1141, damage_t: 867 }]),
    );
    expect(result.stats[0].damage).toBe(2008);
    expect(result.stats[0].adr).toBe(84);
  });

  it('leaves the parsed stats untouched when sabremetrics resolved no rounds', () => {
    const input = parsed([{ player_id: 1, damage: 2067, rounds_played: 24 }]);
    expect(withEnemyDamage(input, sab([]))).toBe(input);
  });

  it('zeroes a player sabremetrics has no row for', () => {
    const result = withEnemyDamage(
      parsed([{ player_id: 2, damage: 500, rounds_played: 20 }]),
      sab([{ player_id: 1, damage_ct: 10, damage_t: 10 }]),
    );
    expect(result.stats[0]).toMatchObject({ damage: 0, adr: 0 });
  });
});
