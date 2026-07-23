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

  for (const [, deaths] of deathsByRound) {
    for (const sid of steamIds) {
      // Find the two enemy players this round
      const enemies = steamIds.filter((other) => other !== sid && !isTeamKill(sid, other, context));

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
