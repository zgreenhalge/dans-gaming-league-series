import type { SabFields } from '../types';
import { isTeamKill, type MatchContext, type PlayerDeathRow } from './matchContext';
import { TRADE_WINDOW_SECONDS } from './constants';

type CollectorOut = Map<string, Partial<SabFields>>;

export function collectKast(
  deathEvents: PlayerDeathRow[],
  context: MatchContext,
  steamIds: string[],
): CollectorOut {
  const out: CollectorOut = new Map();
  const steamSet = new Set(steamIds);
  for (const sid of steamIds) out.set(sid, {});

  const tradeWindow = Math.round(TRADE_WINDOW_SECONDS * context.tickRate);

  // Group deaths by round
  const deathsByRound = new Map<number, PlayerDeathRow[]>();
  for (const d of deathEvents) {
    const round = d.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;
    if (!deathsByRound.has(round)) deathsByRound.set(round, []);
    deathsByRound.get(round)!.push(d);
  }

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

      // T: traded — died but a teammate killed their killer within trade window
      if (!qualifies) {
        const myDeath = deaths.find((d) => d.user_steamid === sid);
        if (myDeath && myDeath.attacker_steamid) {
          const killer = myDeath.attacker_steamid;
          const traded = deaths.some((d) => {
            if (d.user_steamid !== killer) return false;
            if (d.tick <= myDeath.tick) return false;
            if (d.tick - myDeath.tick > tradeWindow) return false;
            const trader = d.attacker_steamid;
            if (!trader || !steamSet.has(trader)) return false;
            // Trader must be on the same side as the dead player
            return isTeamKill(trader, sid, context);
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
