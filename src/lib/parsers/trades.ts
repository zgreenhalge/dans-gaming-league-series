import type { SabFields } from '../types';
import { isTeamKill, type MatchContext, type PlayerDeathRow, type PlayerHurtRow } from './matchContext';
import { TRADE_WINDOW_SECONDS } from './constants';
import type { PlayerPositionRow } from './smokes';

type CollectorOut = Map<string, Partial<SabFields>>;

// How close a teammate must be, in game units, to count as a real trade opportunity — otherwise
// "alive and on the same side" alone credits opportunities from anywhere on the map. Two separate
// legs: close enough to the death itself, AND close enough to the killer to have realistically
// fought them (a teammate can be near the body without a shot at whoever's still standing).
// Deliberately looser than Smokes Blocking Push's SMOKE_BLOCK_RADIUS (180) — that gate approximates
// a smoke cloud's physical size, a much smaller thing than a realistic gunfight distance.
const TRADE_VICTIM_DISTANCE = 360;
const TRADE_KILLER_DISTANCE = 540;

// Squared-distance comparison — same result as Math.sqrt(dx*dx+dy*dy) <= radius without paying
// for the sqrt, since every call site here only ever compares against a threshold.
function withinDistance(a: { x: number; y: number }, b: { x: number; y: number }, radius: number): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy <= radius * radius;
}

/** `{tick}::{steamid}` — the one key format for "some per-player fact at a given tick," shared by
 *  the position index below and the opportunity map computeTradeOpportunities() returns, so
 *  kast.ts (which only needs the latter) can look itself up without knowing position internals. */
export function tradeOpportunityKey(tick: number, steamId: string): string {
  return `${tick}::${steamId}`;
}

/**
 * The distance side of a real trade opportunity: a teammate within TRADE_VICTIM_DISTANCE of the
 * death and within TRADE_KILLER_DISTANCE of the killer. Missing position data for any party fails
 * closed. Internal to computeTradeOpportunities() below — nothing outside this file needs the
 * raw position check once the opportunity map exists.
 */
function isTradeOpportunity(
  teammatePos: { x: number; y: number } | undefined,
  victimPos: { x: number; y: number } | undefined,
  killerPos: { x: number; y: number } | undefined,
): boolean {
  if (!teammatePos || !victimPos || !killerPos) return false;
  return withinDistance(teammatePos, victimPos, TRADE_VICTIM_DISTANCE) &&
    withinDistance(teammatePos, killerPos, TRADE_KILLER_DISTANCE);
}

/** Tick list demoOrchestrator.ts needs to fetch (via parseTicks, all players): one per death, to
 *  check whether a teammate was close enough to plausibly trade. */
export function neededTradeTicks(deathEvents: PlayerDeathRow[], context: MatchContext): number[] {
  const ticks = new Set<number>();
  for (const d of deathEvents) {
    const round = d.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;
    ticks.add(d.tick);
  }
  return [...ticks];
}

export type TradeOpportunities = Map<string, string[]>;

/**
 * For every death in a live round, which of the victim's teammates had a real trade
 * opportunity — alive, on the victim's side, and within both distance legs (see
 * isTradeOpportunity()) of the victim and the killer. Keyed by tradeOpportunityKey(deathTick,
 * victimSteamId) → that death's qualifying teammate steamIds.
 *
 * Computed once per demo parse and shared by collectTrades() below and kast.ts's "Traded"
 * qualifier, so the two consult the exact same result instead of each re-deriving the
 * position/distance logic independently — they can't drift apart because there's only one place
 * left where the opportunity gets decided.
 */
export function computeTradeOpportunities(
  deathEvents: PlayerDeathRow[],
  positionRows: PlayerPositionRow[],
  context: MatchContext,
  steamIds: string[],
): TradeOpportunities {
  const steamSet = new Set(steamIds);

  const positionIndex = new Map<string, { x: number; y: number }>();
  for (const p of positionRows) positionIndex.set(tradeOpportunityKey(p.tick, p.steamid), { x: p.x, y: p.y });

  const deathsByRound = new Map<number, PlayerDeathRow[]>();
  for (const d of deathEvents) {
    const round = d.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;
    if (!deathsByRound.has(round)) deathsByRound.set(round, []);
    deathsByRound.get(round)!.push(d);
  }

  const opportunities: TradeOpportunities = new Map();

  for (const deaths of deathsByRound.values()) {
    for (const victimDeath of deaths) {
      const victim = victimDeath.user_steamid;
      const killer = victimDeath.attacker_steamid;
      if (!victim || !steamSet.has(victim) || !killer) continue; // no attacker (world/unknown) — nobody to trade

      // Teammates still alive at the moment of death — the pool who could possibly trade.
      const aliveTeammates = steamIds.filter((sid) => {
        if (sid === victim) return false;
        if (!isTeamKill(sid, victim, context)) return false;
        const teammateDeath = deaths.find((d) => d.user_steamid === sid);
        return !teammateDeath || teammateDeath.tick > victimDeath.tick;
      });

      // Being alive and on the same side isn't enough — a teammate across the map never had a
      // realistic chance to trade. Two legs: close enough to the victim, AND close enough to the
      // killer to have actually been able to fight them. Missing position data (for any side of
      // either check) fails closed, same convention as smokes.ts's block-radius check.
      const victimPos = positionIndex.get(tradeOpportunityKey(victimDeath.tick, victim));
      const killerPos = positionIndex.get(tradeOpportunityKey(victimDeath.tick, killer));
      const nearbyTeammates = aliveTeammates.filter((sid) => {
        const teammatePos = positionIndex.get(tradeOpportunityKey(victimDeath.tick, sid));
        return isTradeOpportunity(teammatePos, victimPos, killerPos);
      });

      opportunities.set(tradeOpportunityKey(victimDeath.tick, victim), nearbyTeammates);
    }
  }

  return opportunities;
}

/**
 * Trade kill / traded death opportunity-attempt-success counts (#173 phase 1.1).
 *
 * - Opportunity: a teammate (of the dying player) had a real trade opportunity per
 *   computeTradeOpportunities() — i.e. had a realistic chance to see and fight the killer, not
 *   just a theoretical one from anywhere on the map.
 * - Attempt: an opportunity where the teammate dealt damage to the killer within the trade
 *   window.
 * - Success: an opportunity where the teammate killed the killer within the trade window — the
 *   same opportunity map plus trade-window condition kast.ts's KAST "Traded" qualifier checks,
 *   so the two can never disagree.
 *
 * In wingman there's exactly one teammate, so "opportunity" degenerates to a single yes/no check
 * per death rather than a count across a full 5-person side.
 */
export function collectTrades(
  deathEvents: PlayerDeathRow[],
  hurtEvents: PlayerHurtRow[],
  tradeOpportunities: TradeOpportunities,
  context: MatchContext,
  steamIds: string[],
): CollectorOut {
  const out: CollectorOut = new Map();
  const steamSet = new Set(steamIds);
  for (const sid of steamIds) out.set(sid, {});

  const tradeWindow = Math.round(TRADE_WINDOW_SECONDS * context.tickRate);

  const deathsByRound = new Map<number, PlayerDeathRow[]>();
  for (const d of deathEvents) {
    const round = d.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;
    if (!deathsByRound.has(round)) deathsByRound.set(round, []);
    deathsByRound.get(round)!.push(d);
  }

  const hurtsByRound = new Map<number, PlayerHurtRow[]>();
  for (const h of hurtEvents) {
    const round = h.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;
    if (!hurtsByRound.has(round)) hurtsByRound.set(round, []);
    hurtsByRound.get(round)!.push(h);
  }

  for (const round of context.liveRounds) {
    const deaths = deathsByRound.get(round) ?? [];
    const hurts = hurtsByRound.get(round) ?? [];

    for (const victimDeath of deaths) {
      const victim = victimDeath.user_steamid;
      const killer = victimDeath.attacker_steamid;
      if (!victim || !steamSet.has(victim)) continue;
      if (!killer) continue; // no attacker (world/unknown) — nobody to trade

      const windowEnd = victimDeath.tick + tradeWindow;
      const nearbyTeammates = tradeOpportunities.get(tradeOpportunityKey(victimDeath.tick, victim)) ?? [];

      const victimOut = out.get(victim)!;
      if (nearbyTeammates.length > 0) {
        victimOut.traded_death_opportunities = ((victimOut.traded_death_opportunities as number) ?? 0) + 1;
      }

      let victimWasAttempted = false;
      let victimWasTraded = false;

      for (const teammate of nearbyTeammates) {
        const teammateOut = out.get(teammate)!;
        teammateOut.trade_kill_opportunities = ((teammateOut.trade_kill_opportunities as number) ?? 0) + 1;

        const attempted = hurts.some((h) =>
          h.attacker_steamid === teammate && h.user_steamid === killer &&
          h.tick > victimDeath.tick && h.tick <= windowEnd,
        );
        if (attempted) {
          teammateOut.trade_kill_attempts = ((teammateOut.trade_kill_attempts as number) ?? 0) + 1;
          victimWasAttempted = true;
        }

        const succeeded = deaths.some((d) =>
          d.user_steamid === killer && d.attacker_steamid === teammate &&
          d.tick > victimDeath.tick && d.tick <= windowEnd,
        );
        if (succeeded) {
          teammateOut.trade_kill_successes = ((teammateOut.trade_kill_successes as number) ?? 0) + 1;
          victimWasTraded = true;
        }
      }

      if (victimWasAttempted) {
        victimOut.traded_death_attempts = ((victimOut.traded_death_attempts as number) ?? 0) + 1;
      }
      if (victimWasTraded) {
        victimOut.traded_death_successes = ((victimOut.traded_death_successes as number) ?? 0) + 1;
      }
    }
  }

  return out;
}
