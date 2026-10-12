import { canonicalSort, deriveAdr, deriveRwr, isPlayedScore, parseScore } from './util';

// The one place a set of matches (a gauntlet pod's two games, a gauntlet round, a regular-season
// week) is rolled up into per-player records and ranked. `canonicalGauntletRankMap()`
// (gauntlet-ranking.ts), the round list's results panel, and the week/round/group page scorecards
// all read it, so what a scorecard shows is by construction what the rankings are computed from.

/** The per-player fields a scorecard needs from a match — structurally satisfied by `RosterStat`
 *  (schedule.ts) and `GauntletPlayerStat` (queries/gauntlet.ts). */
export interface ScorecardStat {
  player_id: number;
  player_name?: string;
  faction: 'SHIRTS' | 'SKINS';
  is_win: boolean;
  adr: number;
  kills?: number;
  assists?: number;
  deaths?: number;
}

export interface ScorecardMatch {
  final_score: string | null;
  shirts_stats: ScorecardStat[];
  skins_stats: ScorecardStat[];
}

export interface PlayerRecord {
  player_id: number;
  player_name: string;
  matches_played: number;
  wins: number;
  losses: number;
  /** Wins / matches played, 0–100. Normalizes for players who played a different number of matches
   *  (a regular-season doubleheader, a pod's fixed two games). */
  win_rate: number;
  kills: number;
  assists: number;
  deaths: number;
  rounds_won: number;
  rounds_played: number;
  /** Per-match `adr` weighted by the match's rounds — the same round-weighted ADR the canonical
   *  gauntlet ranking has always used. */
  total_damage: number;
  rwr_percentage: number;
  adr: number;
}

/** Which first key orders a scorecard: raw `wins` (the regular-season `canonicalSort`) or `win_rate`
 *  (the canonical gauntlet ranking). Both then break ties by RWR% and ADR. */
type ScorecardRankRule = 'wins' | 'win_rate';

/** Rolls the played matches up into one record per player, in order of first appearance. Unplayed
 *  matches (including `"0-0"` placeholders) are skipped, so a pre-staged week reads as empty. */
export function aggregatePlayerRecords(matches: ScorecardMatch[]): Map<number, PlayerRecord> {
  const records = new Map<number, PlayerRecord>();
  for (const m of matches) {
    if (!isPlayedScore(m.final_score)) continue;
    const scores = parseScore(m.final_score);
    if (!scores) continue;
    const total = scores.shirts + scores.skins;
    for (const p of [...m.shirts_stats, ...m.skins_stats]) {
      const r = records.get(p.player_id) ?? emptyRecord(p.player_id, p.player_name ?? `#${p.player_id}`);
      r.matches_played += 1;
      if (p.is_win) r.wins += 1;
      else r.losses += 1;
      r.kills += p.kills ?? 0;
      r.assists += p.assists ?? 0;
      r.deaths += p.deaths ?? 0;
      r.rounds_won += p.faction === 'SHIRTS' ? scores.shirts : scores.skins;
      r.rounds_played += total;
      r.total_damage += p.adr * total;
      records.set(p.player_id, r);
    }
  }
  for (const r of records.values()) {
    r.win_rate = (r.wins / r.matches_played) * 100;
    r.rwr_percentage = deriveRwr({ total_rounds_played: r.rounds_played, total_rounds_won: r.rounds_won });
    r.adr = deriveAdr({ total_rounds_played: r.rounds_played, total_damage: r.total_damage });
  }
  return records;
}

/** Comparator for `rule`. `wins` delegates to `canonicalSort` itself, so a regular-season scorecard
 *  can't disagree with the season leaderboard's ordering; `win_rate` is the gauntlet's. */
export function compareRecords(rule: ScorecardRankRule): (a: PlayerRecord, b: PlayerRecord) => number {
  if (rule === 'wins') {
    return (a, b) =>
      canonicalSort(
        { matches_won: a.wins, rwr_percentage: a.rwr_percentage, overall_adr: a.adr },
        { matches_won: b.wins, rwr_percentage: b.rwr_percentage, overall_adr: b.adr },
      );
  }
  return (a, b) => b.win_rate - a.win_rate || b.rwr_percentage - a.rwr_percentage || b.adr - a.adr;
}

/** A group's scorecard: every player who played, ranked by `rule`. Ties on every key keep first-
 *  appearance order (a stable sort), exactly as the canonical gauntlet ranking always has. */
export function deriveGroupScorecard(matches: ScorecardMatch[], rule: ScorecardRankRule): PlayerRecord[] {
  return [...aggregatePlayerRecords(matches).values()].sort(compareRecords(rule));
}

/** A record for a player with no played match yet — a materialized pod's occupants appear on its
 *  scorecard from the moment the pod exists. */
export function emptyRecord(player_id: number, player_name: string): PlayerRecord {
  return {
    player_id,
    player_name,
    matches_played: 0,
    wins: 0,
    losses: 0,
    win_rate: 0,
    kills: 0,
    assists: 0,
    deaths: 0,
    rounds_won: 0,
    rounds_played: 0,
    total_damage: 0,
    rwr_percentage: 0,
    adr: 0,
  };
}

/** Whether a player moves on from a finished, non-final gauntlet pod: `single` pods keep only a
 *  player who won every game, `wildcard` pods everyone who won at least one. Mirrors the rule
 *  `resolveAndPropagate()` (gauntlet-engine.ts) applies when it fills the next round. */
export function podAdvances(rule: 'single' | 'wildcard', wins: number, gamesInPod: number): boolean {
  return rule === 'single' ? wins === gamesInPod : wins > 0;
}
