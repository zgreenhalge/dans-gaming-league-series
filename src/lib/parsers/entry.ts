import type { SabFields } from '../types';
import { isTeamKill, type MatchContext, type PlayerDeathRow } from './matchContext';
import { groupByRound, initCollector } from './_shared';

type CollectorOut = Map<string, Partial<SabFields>>;

export function collectEntry(
  deathEvents: PlayerDeathRow[],
  context: MatchContext,
  steamIds: string[],
): CollectorOut {
  const { out, steamSet } = initCollector<SabFields>(steamIds);
  const deathsByRound = groupByRound(deathEvents, context.liveRounds);

  for (const [, deaths] of deathsByRound) {
    deaths.sort((a, b) => a.tick - b.tick);
    const first = deaths[0];

    const attacker = first.attacker_steamid;
    const victim = first.user_steamid;
    if (!victim || !steamSet.has(victim)) continue;

    // Credit opening death to victim
    const vp = out.get(victim)!;
    vp.opening_deaths = ((vp.opening_deaths as number) ?? 0) + 1;

    // Credit opening kill to attacker if not a team kill
    if (attacker && steamSet.has(attacker) && !isTeamKill(attacker, victim, context)) {
      const ap = out.get(attacker)!;
      ap.opening_kills = ((ap.opening_kills as number) ?? 0) + 1;
    }
  }

  return out;
}
