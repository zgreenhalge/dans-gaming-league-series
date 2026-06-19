import type { SabFields } from '../types';
import type { MatchContext } from './matchContext';

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
  const out: CollectorOut = new Map();
  const steamSet = new Set(steamIds);
  for (const sid of steamIds) out.set(sid, {});

  for (const p of plantEvents) {
    const round = p.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;
    const planter = p.user_steamid;
    if (!planter || !steamSet.has(planter)) continue;
    const row = out.get(planter)!;
    row.plants = ((row.plants as number) ?? 0) + 1;
  }

  for (const d of defuseEvents) {
    const round = d.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;
    const defuser = d.user_steamid;
    if (!defuser || !steamSet.has(defuser)) continue;
    const row = out.get(defuser)!;
    row.defuses = ((row.defuses as number) ?? 0) + 1;
  }

  return out;
}
