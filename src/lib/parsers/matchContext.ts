import { parseEvent, parseHeader } from '@laihoe/demoparser2';
import { buildRoundSides, sideForFaction, type RoundEndRow, type RoundSideInfo } from './roundSides';
import { roundOf, type RoundBounds } from './_shared';

/**
 * Tick the live match starts at — the last `begin_new_match`. MatchZy fires it on every warmup
 * restart and on the knife→match transition, so the max tick is the real start. Any round_end
 * before it is warmup or an erroneously-recorded knife round; callers drop those. Returns 0 when
 * the demo has no `begin_new_match` (so nothing is filtered by tick).
 */
export function findMatchStartTick(demoBuffer: Buffer): number {
  let maxTick = 0;
  try {
    const events: { tick: number }[] = parseEvent(demoBuffer, 'begin_new_match');
    for (const e of events) {
      if (typeof e.tick === 'number' && e.tick > maxTick) maxTick = e.tick;
    }
  } catch {
    // event absent/unreadable — leave 0 so no rounds are filtered by tick
  }
  return maxTick;
}

/**
 * Tick the knife phase begins at — the last warmup-restart `begin_new_match`, i.e. the
 * second-to-last `begin_new_match` overall (the last one is the knife→match transition;
 * see `findMatchStartTick`). Used only to show the knife round itself (gauntlet replay);
 * everything that counts toward the score still anchors on `findMatchStartTick`. Returns
 * 0 when there are fewer than two `begin_new_match` events — no reliable boundary to
 * anchor on, so nothing before the demo start is assumed to be the knife phase.
 */
export function findKnifePhaseStartTick(demoBuffer: Buffer): number {
  let ticks: number[] = [];
  try {
    const events: { tick: number }[] = parseEvent(demoBuffer, 'begin_new_match');
    ticks = events
      .map((e) => e.tick)
      .filter((t): t is number => typeof t === 'number')
      .sort((a, b) => a - b);
  } catch {
    return 0;
  }
  return ticks.length < 2 ? 0 : ticks[ticks.length - 2];
}

export interface PlayerDeathRow {
  tick: number;
  total_rounds_played: number;
  attacker_steamid: string | null;
  user_steamid: string | null;
  headshot: boolean;
  /** Attacker was scoped out (sniper rifles only) when the shot was fired. */
  noscope: boolean;
  /** Count of surfaces (wall/door/etc.) the bullet penetrated before landing the kill. */
  penetrated: number;
  /** Attacker was blinded by a flash at the moment of the kill. */
  attackerblind: boolean;
  assister_steamid: string | null;
  weapon: string;
}

export interface PlayerHurtRow {
  tick: number;
  total_rounds_played: number;
  attacker_steamid: string | null;
  user_steamid: string | null;
  weapon: string;
  dmg_health: number;
  hitgroup: string;
}

export interface MatchContext {
  rounds: RoundSideInfo[];
  liveRounds: Set<number>;
  /** Tick the live match begins at — see `RoundBounds`/`roundOf()`. `MatchContext` satisfies
   *  `RoundBounds` structurally (this field plus `liveRounds`), so any collector with `context` in
   *  scope passes `context` itself to `roundOf()`/`groupByRound()`. */
  matchStartTick: number;
  roundEndTicks: Int32Array;
  tickRate: number;
  /** Per-round CT/T side, only populated when the starting side resolves (see `hasSides`). Needed
   *  for CT/T-specific splits; prefer `factionOf`/`isTeamKill()` for "are these two teammates". */
  playerSides: Map<string, Map<number, 'CT' | 'T'>>;
  roundDeaths: Map<string, Set<number>>;
  /** Fixed roster faction (SHIRTS/SKINS), populated unconditionally regardless of `hasSides`. Use
   *  with `isTeamKill()` for same-team checks — robust even when the starting side is unresolved. */
  factionOf: Map<string, 'SHIRTS' | 'SKINS'>;
  warnings: string[];
  hasSides: boolean;
}

/**
 * Groups death rounds per victim: round+1 offset, gated to live rounds, only for known players.
 * Shared by buildMatchContext and the test fixture (matchContextFixture.ts) so the two can't drift.
 */
export function buildRoundDeaths(
  deathEvents: PlayerDeathRow[],
  bounds: RoundBounds,
  isKnownPlayer: (steamId: string) => boolean,
): Map<string, Set<number>> {
  const roundDeaths = new Map<string, Set<number>>();
  for (const d of deathEvents) {
    const roundNumber = roundOf(d, bounds);
    if (roundNumber == null) continue;
    const victim = d.user_steamid;
    if (!victim || !isKnownPlayer(victim)) continue;
    if (!roundDeaths.has(victim)) roundDeaths.set(victim, new Set());
    roundDeaths.get(victim)!.add(roundNumber);
  }
  return roundDeaths;
}

/**
 * Drops any `player_death` event landing on the same (round, victim) as an earlier one — a player
 * can die at most once in a live round, so a second event there is always a genuine anomaly (e.g.
 * a duplicated event from the parser itself), not something any downstream collector should
 * double-count. Applied once, right after `buildMatchContext()`, so every consumer of
 * `deathEvents` (KAST, trades, multikills, teamkills, clutches, utility, `match_kills`, ...) sees
 * the same deduped stream — the same reasoning that put the tick-liveness check in `roundOf()`
 * itself rather than in one collector: a shared invariant belongs at the shared choke point, not
 * re-guarded per caller. Recorded to `context.warnings` (gates auto-commit — see
 * `evaluateAutoCommit()`) so the match routes to manual review instead of confirming with
 * silently-dropped events. Events outside a live round are left in place — `buildRoundDeaths()`
 * (which already ran, since it needs the *raw* stream before `context` exists) collapses
 * duplicates into a `Set` on its own, so running this afterward doesn't change its result.
 */
export function dedupeDeathEvents(deathEvents: PlayerDeathRow[], context: MatchContext): PlayerDeathRow[] {
  const seenRoundVictims = new Set<string>();
  const result: PlayerDeathRow[] = [];
  for (const d of deathEvents) {
    const round = roundOf(d, context);
    const victim = d.user_steamid;
    if (round != null && victim) {
      const key = `${round}::${victim}`;
      if (seenRoundVictims.has(key)) {
        context.warnings.push(
          `Duplicate player_death for ${victim} in round ${round} — kept the first, dropped the rest.`,
        );
        continue;
      }
      seenRoundVictims.add(key);
    }
    result.push(d);
  }
  return result;
}

/**
 * True when `a` and `b` are on the same roster faction (SHIRTS/SKINS). Compares
 * `context.factionOf` — a fixed roster fact populated unconditionally in `buildMatchContext()` —
 * rather than `context.playerSides`, which is only populated when the starting side resolves
 * (`context.hasSides`). Teammates always share a side whenever sides *are* known, so this stays
 * correct even when the starting side can't be resolved.
 */
export function isTeamKill(a: string, b: string, context: MatchContext): boolean {
  const factionA = context.factionOf.get(a);
  return factionA != null && factionA === context.factionOf.get(b);
}

export function buildMatchContext(
  demoBuffer: Buffer,
  roundEndEvents: RoundEndRow[],
  deathEvents: PlayerDeathRow[],
  steamToPlayer: Map<string, { player_id: number; faction: 'SHIRTS' | 'SKINS' }>,
  skinsStartingSide: 'CT' | 'T' | null,
  targetWinRounds: number,
): MatchContext {
  const warnings: string[] = [];

  let tickRate = 64;
  try {
    const header = parseHeader(demoBuffer);
    const parsed = Number(header.tickrate ?? header.tick_rate);
    // CS2 demos frequently omit a usable tickrate in the header; 64 is the correct
    // default for this league, so fall back silently rather than warn.
    if (parsed > 0 && parsed < 1000) {
      tickRate = parsed;
    }
  } catch {
    // header unreadable — keep the 64 default
  }

  const matchStartTick = findMatchStartTick(demoBuffer);
  const rounds = buildRoundSides(roundEndEvents, skinsStartingSide, targetWinRounds, matchStartTick);
  const hasSides = rounds.length > 0;

  if (!hasSides && skinsStartingSide === null) {
    warnings.push(
      'Starting side unknown — CT/T splits will be skipped.',
    );
  }

  const liveRounds = new Set(rounds.map((r) => r.roundNumber));
  const roundEndTicks = Int32Array.from(rounds.map((r) => r.endTick));

  const roundByNumber = new Map<number, RoundSideInfo>();
  for (const r of rounds) roundByNumber.set(r.roundNumber, r);

  const factionOf = new Map<string, 'SHIRTS' | 'SKINS'>();
  for (const [steamId, { faction }] of steamToPlayer) {
    factionOf.set(steamId, faction);
  }

  const playerSides = new Map<string, Map<number, 'CT' | 'T'>>();
  if (hasSides) {
    for (const [steamId, faction] of factionOf) {
      const sideMap = new Map<number, 'CT' | 'T'>();
      for (const r of rounds) {
        sideMap.set(r.roundNumber, sideForFaction(r, faction));
      }
      playerSides.set(steamId, sideMap);
    }
  }

  const roundDeaths = buildRoundDeaths(
    deathEvents,
    { liveRounds, matchStartTick },
    (steamId) => steamToPlayer.has(steamId),
  );

  return {
    rounds,
    liveRounds,
    matchStartTick,
    roundEndTicks,
    tickRate,
    playerSides,
    roundDeaths,
    factionOf,
    warnings,
    hasSides,
  };
}
