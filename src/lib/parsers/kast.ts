import type { SabFields } from '../types';
import { isTeamKill, type MatchContext, type PlayerDeathRow } from './matchContext';
import { TRADE_WINDOW_SECONDS } from './constants';
import { tradeOpportunityKey, type TradeOpportunities } from './trades';
import { groupByRound, initCollector } from './_shared';

type CollectorOut = Map<string, Partial<SabFields>>;

export function collectKast(
  deathEvents: PlayerDeathRow[],
  context: MatchContext,
  steamIds: string[],
  tradeOpportunities: TradeOpportunities,
): CollectorOut {
  const { out } = initCollector<SabFields>(steamIds);
  const tradeWindow = Math.round(TRADE_WINDOW_SECONDS * context.tickRate);
  const deathsByRound = groupByRound(deathEvents, context.liveRounds);

  for (const round of context.liveRounds) {
    const deaths = deathsByRound.get(round) ?? [];
    deaths.sort((a, b) => a.tick - b.tick);

    for (const sid of steamIds) {
      let qualifies = false;

      // K: got a non-teamkill kill this round
      const gotKill = deaths.some(
        (d) => d.attacker_steamid === sid && !isTeamKill(sid, d.user_steamid ?? '', context),
      );
      if (gotKill) qualifies = true;

      // A: got an assist (non-teamkill)
      if (!qualifies) {
        const gotAssist = deaths.some(
          (d) => d.assister_steamid === sid && !isTeamKill(sid, d.user_steamid ?? '', context),
        );
        if (gotAssist) qualifies = true;
      }

      // S: survived
      if (!qualifies) {
        const died = context.roundDeaths.get(sid)?.has(round) ?? false;
        if (!died) qualifies = true;
      }

      // T: traded — died but a teammate with a real trade opportunity for this death (computed
      // once by trades.ts's computeTradeOpportunities() and shared with collectTrades(), so the
      // two can never disagree on who counted) killed their killer within the trade window
      if (!qualifies) {
        const myDeath = deaths.find((d) => d.user_steamid === sid);
        if (myDeath && myDeath.attacker_steamid) {
          const killer = myDeath.attacker_steamid;
          const opportunityTraders = tradeOpportunities.get(tradeOpportunityKey(myDeath.tick, sid)) ?? [];
          const traded = deaths.some((d) => {
            if (d.user_steamid !== killer) return false;
            if (d.tick <= myDeath.tick) return false;
            if (d.tick - myDeath.tick > tradeWindow) return false;
            return !!d.attacker_steamid && opportunityTraders.includes(d.attacker_steamid);
          });
          if (traded) qualifies = true;
        }
      }

      if (qualifies) {
        const p = out.get(sid)!;
        p.kast_rounds = ((p.kast_rounds as number) ?? 0) + 1;
      }
    }
  }

  return out;
}
