import { allMatchesPlayed, isPlayedScore, parseScore, deriveRwr, deriveAdr } from './util';

// Minimal types for canonicalGauntletRankMap — mirrors GauntletRound/GauntletMatch
// from queries/gauntlet.ts without creating a circular import.
interface _GauntletPlayer { player_id: number; faction: 'SHIRTS' | 'SKINS'; is_win: boolean; adr: number }
interface _GauntletMatch { final_score: string | null; shirts_stats: _GauntletPlayer[]; skins_stats: _GauntletPlayer[] }
interface _GauntletRound { round_number: number; matches: _GauntletMatch[] }

/**
 * Canonical gauntlet ranking — returns a Map<player_id, rank> (1-indexed) matching
 * the order the podium is determined:
 *   1st  — 2-0 in the final round (champion)
 *   2nd  — 1-1 in the final round, higher final-round RWR% (then ADR)
 *   3rd  — 1-1 in the final round, lower final-round RWR% (then ADR)
 *   4th  — 0-2 in the final round
 *   5th+ — players eliminated before the final round, ordered by latest elimination
 *          round (higher round = better rank); tiebreak within the same round by
 *          wins in that round, then RWR%, then ADR in that round (all descending)
 *
 * Returns an empty map when the gauntlet is not yet complete.
 * Use this instead of canonicalSort wherever gauntlet leaderboards are rendered.
 */
export function canonicalGauntletRankMap(rounds: _GauntletRound[]): Map<number, number> {
  if (rounds.length === 0) return new Map();

  const maxRound = Math.max(...rounds.map((r) => r.round_number));
  const finalRound = rounds.find((r) => r.round_number === maxRound);
  if (!finalRound || !allMatchesPlayed(finalRound.matches)) {
    return new Map();
  }

  // Compute per-player record, RWR% and ADR for a given set of matches.
  // ADR is round-weighted (per-match adr * rounds) so it aggregates correctly.
  function aggregateRound(matches: _GauntletMatch[]) {
    const agg = new Map<number, { wins: number; rounds_won: number; rounds_played: number; total_damage: number }>();
    for (const m of matches) {
      if (!isPlayedScore(m.final_score)) continue;
      const scores = parseScore(m.final_score);
      if (!scores) continue;
      const total = scores.shirts + scores.skins;
      for (const p of [...m.shirts_stats, ...m.skins_stats]) {
        const prev = agg.get(p.player_id) ?? { wins: 0, rounds_won: 0, rounds_played: 0, total_damage: 0 };
        prev.wins += p.is_win ? 1 : 0;
        prev.rounds_won += p.faction === 'SHIRTS' ? scores.shirts : scores.skins;
        prev.rounds_played += total;
        prev.total_damage += p.adr * total;
        agg.set(p.player_id, prev);
      }
    }
    return agg;
  }

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

  // Final round: rank 1–4 by record then RWR%.
  const finalAgg = aggregateRound(finalRound.matches);
  const finalPlayers = Array.from(finalAgg.entries()).map(([id, s]) => ({
    player_id: id,
    wins: s.wins,
    rwr: deriveRwr({ total_rounds_played: s.rounds_played, total_rounds_won: s.rounds_won }),
    adr: deriveAdr({ total_rounds_played: s.rounds_played, total_damage: s.total_damage }),
  }));

  finalPlayers.sort((a, b) => b.wins - a.wins || b.rwr - a.rwr || b.adr - a.adr);

  const rankMap = new Map<number, number>();
  finalPlayers.forEach((p, i) => rankMap.set(p.player_id, i + 1));

  // Earlier rounds: players whose last round < maxRound were eliminated there.
  // Later elimination round = better rank. Tiebreak: wins in that round, then RWR%.
  const eliminated: { player_id: number; lastRound: number; wins: number; rwr: number; adr: number }[] = [];
  for (const [id, lastRound] of playerLastRound) {
    if (lastRound >= maxRound) continue;
    const r = rounds.find((r) => r.round_number === lastRound);
    const agg = r ? aggregateRound(r.matches) : new Map();
    const s = agg.get(id);
    eliminated.push({
      player_id: id,
      lastRound,
      wins: s?.wins ?? 0,
      rwr: deriveRwr({ total_rounds_played: s?.rounds_played ?? 0, total_rounds_won: s?.rounds_won ?? 0 }),
      adr: deriveAdr({ total_rounds_played: s?.rounds_played ?? 0, total_damage: s?.total_damage ?? 0 }),
    });
  }

  // Sort: later eliminated = better (lower rank number), then wins desc, then RWR% desc, then ADR desc.
  eliminated.sort((a, b) => b.lastRound - a.lastRound || b.wins - a.wins || b.rwr - a.rwr || b.adr - a.adr);

  const nextRank = finalPlayers.length + 1;
  eliminated.forEach((p, i) => rankMap.set(p.player_id, nextRank + i));

  return rankMap;
}
