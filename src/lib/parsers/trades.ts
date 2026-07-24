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

/** `{tick}::{steamid}` → position, built once per collector run from a flat position-tick fetch. */
export function buildPositionIndex(positionRows: PlayerPositionRow[]): Map<string, { x: number; y: number }> {
  const index = new Map<string, { x: number; y: number }>();
  for (const p of positionRows) index.set(`${p.tick}::${p.steamid}`, { x: p.x, y: p.y });
  return index;
}

/**
 * The distance side of a real trade opportunity: a teammate within TRADE_VICTIM_DISTANCE of the
 * death and within TRADE_KILLER_DISTANCE of the killer. Shared by collectTrades() and kast.ts's
 * "Traded" qualifier so the two conditions can never drift apart. Missing position data for any
 * party fails closed.
 */
export function isTradeOpportunity(
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

/**
 * Trade kill / traded death opportunity-attempt-success counts (#173 phase 1.1).
 *
 * - Opportunity: a teammate (of the dying player) was still alive when the death happened, within
 *   TRADE_VICTIM_DISTANCE of the death, and within TRADE_KILLER_DISTANCE of the killer — i.e. had
 *   a realistic chance to see and fight the killer, not just a theoretical one from anywhere on
 *   the map (being near the body alone doesn't mean there was a shot at whoever's still standing).
 * - Attempt: an opportunity where the teammate dealt damage to the killer within the trade
 *   window.
 * - Success: an opportunity where the teammate killed the killer within the trade window — the
 *   same distance-gated opportunity plus trade-window condition kast.ts's KAST "Traded" qualifier
 *   checks via isTradeOpportunity(), so the two can never disagree.
 *
 * In wingman there's exactly one teammate, so "opportunity" degenerates to a single yes/no check
 * per death rather than a count across a full 5-person side.
 */
export function collectTrades(
  deathEvents: PlayerDeathRow[],
  hurtEvents: PlayerHurtRow[],
  positionRows: PlayerPositionRow[],
  context: MatchContext,
  steamIds: string[],
): CollectorOut {
  const out: CollectorOut = new Map();
  const steamSet = new Set(steamIds);
  for (const sid of steamIds) out.set(sid, {});

  const tradeWindow = Math.round(TRADE_WINDOW_SECONDS * context.tickRate);

  const positionByTickAndPlayer = buildPositionIndex(positionRows);

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
      const victimPos = positionByTickAndPlayer.get(`${victimDeath.tick}::${victim}`);
      const killerPos = positionByTickAndPlayer.get(`${victimDeath.tick}::${killer}`);
      const nearbyTeammates = aliveTeammates.filter((sid) => {
        const teammatePos = positionByTickAndPlayer.get(`${victimDeath.tick}::${sid}`);
        return isTradeOpportunity(teammatePos, victimPos, killerPos);
      });

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
