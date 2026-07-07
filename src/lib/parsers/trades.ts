import type { SabFields } from '../types';
import type { MatchContext, PlayerDeathRow } from './matchContext';
import { TRADE_WINDOW_SECONDS } from './constants';

type CollectorOut = Map<string, Partial<SabFields>>;

export interface PlayerHurtRow {
  tick: number;
  total_rounds_played: number;
  attacker_steamid: string | null;
  user_steamid: string | null;
}

// Same permissive convention as kast.ts's KAST qualifiers: an unknown side never disqualifies —
// it only excludes when both sides are known and actually differ.
function sameSide(context: MatchContext, round: number, a: string, b: string): boolean {
  const sideA = context.playerSides.get(a)?.get(round);
  const sideB = context.playerSides.get(b)?.get(round);
  return sideA == null || sideB == null || sideA === sideB;
}

/**
 * Trade kill / traded death opportunity-attempt-success counts (#173 phase 1.1).
 *
 * - Opportunity: a teammate (of the dying player) was still alive when the death happened —
 *   i.e. had the chance to trade.
 * - Attempt: an opportunity where the teammate dealt damage to the killer within the trade
 *   window.
 * - Success: an opportunity where the teammate killed the killer within the trade window — the
 *   same condition kast.ts's KAST "Traded" qualifier already checks, kept in lockstep here so the
 *   two never disagree.
 *
 * In wingman there's exactly one teammate, so "opportunity" degenerates to a single yes/no check
 * per death rather than a count across a full 5-person side.
 */
export function collectTrades(
  deathEvents: PlayerDeathRow[],
  hurtEvents: PlayerHurtRow[],
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

      // Teammates still alive at the moment of death — the pool who could possibly trade.
      const aliveTeammates = steamIds.filter((sid) => {
        if (sid === victim) return false;
        if (!sameSide(context, round, sid, victim)) return false;
        const teammateDeath = deaths.find((d) => d.user_steamid === sid);
        return !teammateDeath || teammateDeath.tick > victimDeath.tick;
      });

      const victimOut = out.get(victim)!;
      if (aliveTeammates.length > 0) {
        victimOut.traded_death_opportunities = ((victimOut.traded_death_opportunities as number) ?? 0) + 1;
      }

      let victimWasAttempted = false;
      let victimWasTraded = false;

      for (const teammate of aliveTeammates) {
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
