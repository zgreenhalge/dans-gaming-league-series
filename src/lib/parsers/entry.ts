import type { SabFields } from '../types';
import type { MatchContext, PlayerDeathRow } from './matchContext';

type CollectorOut = Map<string, Partial<SabFields>>;

export function collectEntry(
  deathEvents: PlayerDeathRow[],
  context: MatchContext,
  steamIds: string[],
): CollectorOut {
  const out: CollectorOut = new Map();
  const steamSet = new Set(steamIds);
  for (const sid of steamIds) out.set(sid, {});

  // Group deaths by round, sorted by tick
  const deathsByRound = new Map<number, PlayerDeathRow[]>();
  for (const d of deathEvents) {
    const round = d.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;
    if (!deathsByRound.has(round)) deathsByRound.set(round, []);
    deathsByRound.get(round)!.push(d);
  }

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
    if (attacker && steamSet.has(attacker)) {
      const round = first.total_rounds_played + 1;
      const attackerSide = context.playerSides.get(attacker)?.get(round);
      const victimSide = context.playerSides.get(victim)?.get(round);
      const isTeamKill = attackerSide != null && attackerSide === victimSide;

      if (!isTeamKill) {
        const ap = out.get(attacker)!;
        ap.opening_kills = ((ap.opening_kills as number) ?? 0) + 1;
      }
    }
  }

  return out;
}
