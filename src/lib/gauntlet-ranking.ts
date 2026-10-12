import { allMatchesPlayed, finalRoundOf } from './util';
import { aggregatePlayerRecords, type ScorecardMatch } from './group-scorecard';

// Minimal types for canonicalGauntletRankMap — mirrors GauntletRound/GauntletMatch
// from queries/gauntlet.ts without creating a circular import.
type _GauntletMatch = ScorecardMatch;
interface _GauntletRound { round_number: number; matches: _GauntletMatch[]; is_final_round?: boolean }

/**
 * Canonical gauntlet ranking — returns a Map<player_id, rank> (1-indexed) matching
 * the order the podium is determined:
 *   1st  — 2-0 in the final round (champion)
 *   2nd  — 1-1 in the final round, higher final-round RWR% (then ADR)
 *   3rd  — 1-1 in the final round, lower final-round RWR% (then ADR)
 *   4th  — 0-2 in the final round
 *   5th+ — players eliminated before the final round, ordered by latest elimination
 *          round (higher round = better rank); tiebreak within the same round by
 *          win rate in that round, then RWR%, then ADR in that round (all descending)
 *
 * Returns an empty map when the gauntlet is not yet complete.
 * Use this instead of canonicalSort wherever gauntlet leaderboards are rendered.
 *
 * `finalRoundNumber` (from `finalRoundNumberOf(getGauntletBracketShape(...))`, see `finalRoundOf()`
 * in `util.ts`) is the bracket's authoritative final round number — pass it whenever bracket data is
 * available so a final round that hasn't been scheduled yet reads as "not complete" even though
 * `rounds` only ever contains real, scheduled rounds and so has nothing flagged `is_final_round` in
 * that case. Omit it only when no bracket data is on hand (e.g. a hand-built round list in a test).
 */
export function canonicalGauntletRankMap(
  rounds: _GauntletRound[],
  finalRoundNumber?: number | null,
): Map<number, number> {
  if (rounds.length === 0) return new Map();

  const finalRound = finalRoundOf(rounds, finalRoundNumber);
  if (!finalRound || !allMatchesPlayed(finalRound.matches)) {
    return new Map();
  }
  const maxRound = finalRound.round_number;

  // Per-player record, win rate, RWR% and ADR for a set of matches — the shared scorecard rollup.
  const aggregateRound = aggregatePlayerRecords;

  // Determine each player's last-appeared round.
  const playerLastRound = new Map<number, number>();
  for (const r of rounds) {
    for (const m of r.matches) {
      for (const p of [...m.shirts_stats, ...m.skins_stats]) {
        const prev = playerLastRound.get(p.player_id) ?? 0;
        if (r.round_number > prev) playerLastRound.set(p.player_id, r.round_number);
      }
    }
  }

  // Final round: rank 1–4 by win rate then RWR%.
  const finalAgg = aggregateRound(finalRound.matches);
  const finalPlayers = Array.from(finalAgg.entries()).map(([id, s]) => ({
    player_id: id,
    winRate: s.win_rate,
    rwr: s.rwr_percentage,
    adr: s.adr,
  }));

  finalPlayers.sort((a, b) => b.winRate - a.winRate || b.rwr - a.rwr || b.adr - a.adr);

  const rankMap = new Map<number, number>();
  finalPlayers.forEach((p, i) => rankMap.set(p.player_id, i + 1));

  // Earlier rounds: players whose last round < maxRound were eliminated there.
  // Later elimination round = better rank. Tiebreak: win rate in that round, then RWR%.
  const eliminated: { player_id: number; lastRound: number; winRate: number; rwr: number; adr: number }[] = [];
  for (const [id, lastRound] of playerLastRound) {
    if (lastRound >= maxRound) continue;
    const r = rounds.find((r) => r.round_number === lastRound);
    const agg = r ? aggregateRound(r.matches) : new Map();
    const s = agg.get(id);
    eliminated.push({
      player_id: id,
      lastRound,
      winRate: s?.win_rate ?? 0,
      rwr: s?.rwr_percentage ?? 0,
      adr: s?.adr ?? 0,
    });
  }

  // Sort: later eliminated = better (lower rank number), then win rate desc, then RWR% desc, then ADR desc.
  eliminated.sort((a, b) => b.lastRound - a.lastRound || b.winRate - a.winRate || b.rwr - a.rwr || b.adr - a.adr);

  const nextRank = finalPlayers.length + 1;
  eliminated.forEach((p, i) => rankMap.set(p.player_id, nextRank + i));

  return rankMap;
}
