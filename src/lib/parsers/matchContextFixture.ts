/**
 * Minimal MatchContext builder for collector unit tests (kast/clutch/objectives/entry/multikill/
 * utility). Skips buildMatchContext's demo-parsing (tickrate detection, round-side derivation from
 * round-end events) and lets a test specify per-player sides and round winners directly. Not a
 * *.test.ts file itself — it's imported by the actual test files, not run by `npm test`.
 */
import type { MatchContext, PlayerDeathRow } from './matchContext';
import type { RoundSideInfo } from './roundSides';

export function makeContext(opts: {
  rounds: { roundNumber: number; winnerSide: 'CT' | 'T' | null; endTick?: number }[];
  sides: Record<string, 'CT' | 'T'>;
  sidesByRound?: Record<number, Record<string, 'CT' | 'T'>>;
  deaths?: PlayerDeathRow[];
  tickRate?: number;
  hasSides?: boolean;
}): MatchContext {
  const rounds: RoundSideInfo[] = opts.rounds.map((r) => ({
    roundNumber: r.roundNumber,
    endTick: r.endTick ?? r.roundNumber * 1000,
    winnerSide: r.winnerSide,
    shirtsSide: 'CT', // not consulted by collectors — they read playerSides directly
  }));

  const liveRounds = new Set(rounds.map((r) => r.roundNumber));

  const playerSides = new Map<string, Map<number, 'CT' | 'T'>>();
  for (const sid of Object.keys(opts.sides)) {
    const m = new Map<number, 'CT' | 'T'>();
    for (const r of rounds) {
      const override = opts.sidesByRound?.[r.roundNumber]?.[sid];
      m.set(r.roundNumber, override ?? opts.sides[sid]);
    }
    playerSides.set(sid, m);
  }

  const roundDeaths = new Map<string, Set<number>>();
  for (const d of opts.deaths ?? []) {
    const round = d.total_rounds_played + 1;
    if (!liveRounds.has(round)) continue;
    const victim = d.user_steamid;
    if (!victim || !(victim in opts.sides)) continue;
    if (!roundDeaths.has(victim)) roundDeaths.set(victim, new Set());
    roundDeaths.get(victim)!.add(round);
  }

  return {
    rounds,
    liveRounds,
    roundEndTicks: Int32Array.from(rounds.map((r) => r.endTick)),
    tickRate: opts.tickRate ?? 64,
    playerSides,
    roundDeaths,
    factionOf: new Map(),
    warnings: [],
    hasSides: opts.hasSides ?? true,
  };
}

export function death(opts: {
  round: number;
  tick: number;
  victim: string | null;
  attacker?: string | null;
  assister?: string | null;
  headshot?: boolean;
}): PlayerDeathRow {
  return {
    tick: opts.tick,
    total_rounds_played: opts.round - 1,
    user_steamid: opts.victim,
    attacker_steamid: opts.attacker ?? null,
    assister_steamid: opts.assister ?? null,
    headshot: opts.headshot ?? false,
  };
}
