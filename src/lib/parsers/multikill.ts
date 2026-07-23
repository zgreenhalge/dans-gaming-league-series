import type { SabFields } from '../types';
import { isTeamKill, type MatchContext, type PlayerDeathRow } from './matchContext';

type CollectorOut = Map<string, Partial<SabFields>>;

export function collectMultikill(
  deathEvents: PlayerDeathRow[],
  context: MatchContext,
  steamIds: string[],
): CollectorOut {
  const out: CollectorOut = new Map();
  for (const sid of steamIds) out.set(sid, {});

  // Group deaths by round
  const deathsByRound = new Map<number, PlayerDeathRow[]>();
  for (const d of deathEvents) {
    const round = d.total_rounds_played + 1;
    if (!context.liveRounds.has(round)) continue;
    if (!deathsByRound.has(round)) deathsByRound.set(round, []);
    deathsByRound.get(round)!.push(d);
  }

  // Faction (and so who's an enemy) is fixed for the whole match — compute it once per player
  // rather than re-deriving it every round.
  const enemiesOf = new Map<string, string[]>(
    steamIds.map((sid) => [sid, steamIds.filter((other) => other !== sid && !isTeamKill(sid, other, context))]),
  );

  for (const [, deaths] of deathsByRound) {
    for (const sid of steamIds) {
      const enemies = enemiesOf.get(sid)!;
      if (enemies.length !== 2) continue;

      // 2K = player killed both enemies (non-teamkill, attacker on both enemy deaths)
      const killedBoth = enemies.every((enemy) =>
        deaths.some(
          (d) => d.user_steamid === enemy && d.attacker_steamid === sid,
        ),
      );

      if (killedBoth) {
        const p = out.get(sid)!;
        p.two_k_rounds = ((p.two_k_rounds as number) ?? 0) + 1;
      }
    }
  }

  return out;
}
