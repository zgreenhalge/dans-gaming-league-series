import type { SabFields } from '../types';
import type { MatchContext } from './matchContext';
import { initCollector, roundOf } from './_shared';

type CollectorOut = Map<string, Partial<SabFields>>;

export interface BombEventRow {
  tick: number;
  total_rounds_played: number;
  user_steamid: string | null;
}

export function collectObjectives(
  plantEvents: BombEventRow[],
  defuseEvents: BombEventRow[],
  context: MatchContext,
  steamIds: string[],
): CollectorOut {
  const { out, steamSet } = initCollector<SabFields>(steamIds);

  for (const p of plantEvents) {
    if (roundOf(p, context.liveRounds) == null) continue;
    const planter = p.user_steamid;
    if (!planter || !steamSet.has(planter)) continue;
    const row = out.get(planter)!;
    row.plants = ((row.plants as number) ?? 0) + 1;
  }

  for (const d of defuseEvents) {
    if (roundOf(d, context.liveRounds) == null) continue;
    const defuser = d.user_steamid;
    if (!defuser || !steamSet.has(defuser)) continue;
    const row = out.get(defuser)!;
    row.defuses = ((row.defuses as number) ?? 0) + 1;
  }

  return out;
}
