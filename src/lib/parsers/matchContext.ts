import { parseEvent, parseHeader, parseTicks } from '@laihoe/demoparser2';
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

/**
 * Whether the attacker was airborne (mid-air, not touching a surface) at the exact tick of each
 * kill. Unlike `headshot`/`noscope`/`penetrated`/`attackerblind`, this isn't a field on
 * `player_death` itself — it's the attacker's own `is_airborne` tick state (derived from
 * `m_hGroundEntity`), read via one `parseTicks()` call over just the kill ticks, since a kill's
 * exact tick isn't guaranteed to land on any other already-sampled tick set (frame downsampling,
 * round boundaries, ...). Keyed by `${tick}:${attackerSteamId}` since `parseTicks()` returns
 * every player's row at each requested tick, not just the attacker's. Shared by the stats path
 * (`weaponStats.ts`'s `collectMatchKills()`) and the replay path (`extract.ts`'s
 * `collectEvents()`) so "was this a mid-air kill" is computed identically in both.
 */
export function collectMidairAttackers(
  demoBuffer: Buffer,
  deathEvents: { tick: number; attacker_steamid: string | null }[],
): Map<string, boolean> {
  const ticks = [...new Set(deathEvents.filter((d) => d.attacker_steamid).map((d) => d.tick))];
  const map = new Map<string, boolean>();
  if (ticks.length === 0) return map;
  const rows = parseTicks(demoBuffer, ['is_airborne'], ticks) as Record<string, unknown>[];
  for (const row of rows) {
    const tick = Number(row.tick ?? -1);
    const steamid = (row.steamid ?? row.steamID) as string | undefined;
    if (tick < 0 || !steamid) continue;
    map.set(`${tick}:${steamid}`, Boolean(row.is_airborne));
  }
  return map;
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
  /** Per-round "settle tick" — see `computeSettleTicks()`. Parallel to `rounds`. */
  settleTicks: Int32Array;
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

/** Best-effort settle tick for the match's last round, which has no following
 *  `round_officially_ended` to anchor on (see `computeSettleTicks()`) — the observed
 *  `mp_round_restart_delay` (#491), applied as an approximation rather than a confirmed read. */
const FINAL_ROUND_SETTLE_FALLBACK_TICKS = 320;

/**
 * A round-scoped engine netprop (e.g. `m_flTotalRoundDamageDealt`) resets not at `round_end`'s own
 * tick, but ~`mp_round_restart_delay` later, at the next round's `round_officially_ended`/
 * `round_start` — real trailing action can still land in that gap (a player still alive and
 * shooting during the post-round delay), and reading the netprop exactly at `round_end` misses it
 * (#491). The "settle tick" is the latest tick still guaranteed to be *before* that reset: one tick
 * before the next `round_officially_ended` tick after this round's `endTick` — the reset is already
 * complete *by* `round_officially_ended`'s own tick (confirmed against real data: sampling exactly
 * at that tick already reads 0), so reading there instead of one tick earlier would read the reset,
 * not the settled value. The next round's tick is found dynamically per round rather than assumed at
 * a fixed offset — the gap is usually ~320 ticks (5s) but isn't always (an observed outlier of 960 in
 * real data). The match's last round has no following `round_officially_ended` to anchor on (no next
 * round is ever created), so it falls back to `endTick + FINAL_ROUND_SETTLE_FALLBACK_TICKS` as a
 * best-effort approximation.
 */
export function computeSettleTicks(
  rounds: RoundSideInfo[],
  officiallyEndedTicks: number[],
): Int32Array {
  const sorted = [...officiallyEndedTicks].sort((a, b) => a - b);
  return Int32Array.from(rounds.map((r) => {
    const next = sorted.find((t) => t > r.endTick);
    return next !== undefined ? next - 1 : r.endTick + FINAL_ROUND_SETTLE_FALLBACK_TICKS;
  }));
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
  officiallyEndedTicks: number[] = [],
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
  const settleTicks = computeSettleTicks(rounds, officiallyEndedTicks);

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
    settleTicks,
    tickRate,
    playerSides,
    roundDeaths,
    factionOf,
    warnings,
    hasSides,
  };
}
