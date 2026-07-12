import type { SabFields } from '../types';
import type { MatchContext, PlayerDeathRow } from './matchContext';

type CollectorOut = Map<string, Partial<SabFields>>;

function bumpClutch(
  p: Partial<SabFields>,
  attemptsKey: 'clutch_1v1_attempts' | 'clutch_1v2_attempts' | 'clutch_2v1_attempts',
  winsKey: 'clutch_1v1_wins' | 'clutch_1v2_wins' | 'clutch_2v1_wins',
  won: boolean,
): void {
  p[attemptsKey] = ((p[attemptsKey] as number) ?? 0) + 1;
  if (won) p[winsKey] = ((p[winsKey] as number) ?? 0) + 1;
}

export function collectClutch(
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

  for (const round of context.liveRounds) {
    const deaths = (deathsByRound.get(round) ?? []).sort((a, b) => a.tick - b.tick);

    // Determine who starts alive on each side (from roster players only)
    const ctPlayers = new Set<string>();
    const tPlayers = new Set<string>();
    for (const sid of steamIds) {
      const side = context.playerSides.get(sid)?.get(round);
      if (side === 'CT') ctPlayers.add(sid);
      else if (side === 'T') tPlayers.add(sid);
    }

    const ctAlive = new Set(ctPlayers);
    const tAlive = new Set(tPlayers);

    // `round` is fixed for this whole iteration, so look it up once rather than per death/side.
    const roundInfo = context.rounds.find((r) => r.roundNumber === round);

    // Track which player entered a clutch situation, and which side entered a 2v1 advantage —
    // both first-occurrence-only per round, same reasoning: once true it stays true until the
    // next death changes the alive counts, so only the first check matters.
    const clutchRecorded = new Set<string>();
    const advantageRecorded = new Set<string>();

    for (const death of deaths) {
      const victim = death.user_steamid;
      if (!victim || !steamSet.has(victim)) continue;

      // Remove victim from alive set
      ctAlive.delete(victim);
      tAlive.delete(victim);

      // After this death, check if anyone is now in a clutch, or a side now has the numbers
      // advantage for a potential 2v1 choke.
      for (const side of ['CT', 'T'] as const) {
        const myAlive = side === 'CT' ? ctAlive : tAlive;
        const enemyAlive = side === 'CT' ? tAlive : ctAlive;
        if (enemyAlive.size === 0) continue;

        const won = roundInfo?.winnerSide === side;

        if (myAlive.size === 1) {
          const clutcher = [...myAlive][0];
          if (clutchRecorded.has(clutcher)) continue;

          const enemyCount = enemyAlive.size;
          // Only track 1v1/1v2. Checked before recording, not after: a player currently
          // outnumbered 3+ shouldn't be locked out of a real 1v1/1v2 later this round once
          // teammates cut the enemy count down.
          if (enemyCount > 2) continue;

          clutchRecorded.add(clutcher);
          const p = out.get(clutcher)!;
          if (enemyCount === 1) {
            bumpClutch(p, 'clutch_1v1_attempts', 'clutch_1v1_wins', won);
          } else if (enemyCount === 2) {
            bumpClutch(p, 'clutch_1v2_attempts', 'clutch_1v2_wins', won);
          }
        } else if (myAlive.size === 2 && enemyAlive.size === 1) {
          // A 2v1 numbers advantage — the natural stat driving Choke Score's "2v1 losses" term.
          // Both players on the advantaged side share the attempt/loss: with a full-team-vs-one
          // advantage, the choke isn't attributable to a single "clutcher" the way 1v1/1v2 is.
          const advantageKey = `${round}::${side}`;
          if (advantageRecorded.has(advantageKey)) continue;
          advantageRecorded.add(advantageKey);

          for (const teammate of myAlive) {
            bumpClutch(out.get(teammate)!, 'clutch_2v1_attempts', 'clutch_2v1_wins', won);
          }
        }
      }
    }
  }

  return out;
}
