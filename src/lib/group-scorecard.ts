import { canonicalSort, deriveAdr, deriveKd, deriveRwr, isPlayedScore, parseScore } from './util';

// The one place a set of matches (a gauntlet pod's two games, a gauntlet round, a regular-season
// week) is rolled up into per-player records and ranked. `canonicalGauntletRankMap()`
// (gauntlet-ranking.ts), `rankPlayersThroughWeek()` (season-standings.ts), the round list's results
// panel, and the week/round/group page scorecards all read it, so what a scorecard shows is by
// construction what the rankings are computed from.

/** The per-player fields a scorecard needs from a match — structurally satisfied by `RosterStat`
 *  (schedule.ts) and `GauntletPlayerStat` (queries/gauntlet.ts). */
export interface ScorecardStat {
  player_id: number;
  player_name?: string;
  faction: 'SHIRTS' | 'SKINS';
  is_win: boolean;
  adr: number;
  kills?: number;
  deaths?: number;
  /** The raw `player_match_stats` totals. When a stat carries all three (with `rounds_played` > 0)
   *  the rollup uses them as they are — the same `damage / rounds_played` the season leaderboard
   *  divides — instead of rebuilding rounds from the score and damage from the rounded `adr`. */
  damage?: number;
  rounds_won?: number;
  rounds_played?: number;
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
  deaths: number;
  /** Kills per death (`deriveKd()`). */
  kd_ratio: number;
  rounds_won: number;
  rounds_played: number;
  /** Summed raw damage (`ScorecardStat.damage`), or the rounded per-match `adr` weighted by the
   *  match's rounds for a stat without raw totals. */
  total_damage: number;
  rwr_percentage: number;
  adr: number;
}

/** Which first key orders a scorecard: raw `wins` (the regular-season `canonicalSort`) or `win_rate`
 *  (the canonical gauntlet ranking). Both then break ties by RWR% and ADR. */
type ScorecardRankRule = 'wins' | 'win_rate';

/** What one stat adds to a player's rounds and damage in a played match: its own raw totals when it
 *  has them, else the rounds the score implies and the rounded `adr` times the match's rounds. */
function matchTotals(p: ScorecardStat, scores: { shirts: number; skins: number }) {
  if (p.damage != null && p.rounds_won != null && p.rounds_played != null && p.rounds_played > 0) {
    return { rounds_won: p.rounds_won, rounds_played: p.rounds_played, damage: p.damage };
  }
  const total = scores.shirts + scores.skins;
  return {
    rounds_won: p.faction === 'SHIRTS' ? scores.shirts : scores.skins,
    rounds_played: total,
    damage: p.adr * total,
  };
}

/** Rolls the played matches up into one record per player, in order of first appearance. Unplayed
 *  matches (including `"0-0"` placeholders) are skipped, so a pre-staged week reads as empty. */
export function aggregatePlayerRecords(matches: ScorecardMatch[]): Map<number, PlayerRecord> {
  const records = new Map<number, PlayerRecord>();
  for (const m of matches) {
    if (!isPlayedScore(m.final_score)) continue;
    const scores = parseScore(m.final_score);
    if (!scores) continue;
    for (const p of [...m.shirts_stats, ...m.skins_stats]) {
      const totals = matchTotals(p, scores);
      const r = records.get(p.player_id) ?? emptyRecord(p.player_id, p.player_name ?? `#${p.player_id}`);
      r.matches_played += 1;
      if (p.is_win) r.wins += 1;
      else r.losses += 1;
      r.kills += p.kills ?? 0;
      r.deaths += p.deaths ?? 0;
      r.rounds_won += totals.rounds_won;
      r.rounds_played += totals.rounds_played;
      r.total_damage += totals.damage;
      records.set(p.player_id, r);
    }
  }
  for (const r of records.values()) {
    r.win_rate = (r.wins / r.matches_played) * 100;
    r.kd_ratio = deriveKd({ total_kills: r.kills, total_deaths: r.deaths });
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

/** A group's scorecard: every player who played, ranked by `rule`, then each `roster` player with no
 *  played match yet (a week's bye player, an unplayed pod's occupants) as an empty record, in roster
 *  order. Ties on every key keep first-appearance order (a stable sort), as in the canonical
 *  gauntlet ranking. */
export function deriveGroupScorecard(
  matches: ScorecardMatch[],
  rule: ScorecardRankRule,
  roster: { player_id: number; player_name: string }[] = [],
): PlayerRecord[] {
  const records = aggregatePlayerRecords(matches);
  const ranked = [...records.values()].sort(compareRecords(rule));
  const waiting = roster.filter((p) => !records.has(p.player_id)).map((p) => emptyRecord(p.player_id, p.player_name));
  return [...ranked, ...waiting];
}

/** Whether a record has any played match behind its figures — the scorecards show a dash for a
 *  player's rates until they do. */
export function hasPlayed(record: Pick<PlayerRecord, 'matches_played'>): boolean {
  return record.matches_played > 0;
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
    deaths: 0,
    kd_ratio: 0,
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
