import type { SabFields } from '../types';
import { isTeamKill, type MatchContext, type PlayerDeathRow } from './matchContext';
import { initCollector, roundOf } from './_shared';

type CollectorOut = Map<string, Partial<SabFields>>;

/** Teamkills committed, credited to the attacker — the same side check entry.ts/kast.ts use to
 *  exclude a teamkill from opening kills/KAST, just counted here instead of discarded. */
export function collectTeamkill(
  deathEvents: PlayerDeathRow[],
  context: MatchContext,
  steamIds: string[],
): CollectorOut {
  const { out, steamSet } = initCollector<SabFields>(steamIds);

  for (const d of deathEvents) {
    if (roundOf(d, context.liveRounds) == null) continue;

    const attacker = d.attacker_steamid;
    const victim = d.user_steamid;
    if (!attacker || !victim || attacker === victim) continue;
    if (!steamSet.has(attacker) || !steamSet.has(victim)) continue;

    if (isTeamKill(attacker, victim, context)) {
      const ap = out.get(attacker)!;
      ap.teamkills = ((ap.teamkills as number) ?? 0) + 1;
    }
  }

  return out;
}
