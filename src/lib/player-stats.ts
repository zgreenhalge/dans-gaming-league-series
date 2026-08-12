import { isPlayedScore, deriveRates, groupByMap } from './util';

// ─── Player stat aggregation ─────────────────────────────────────────────────

/** The per-match fields `aggregatePlayerStats`/`aggregatePlayerStatsByMap` sum over — a structural
 *  subset of `PlayerHistoryRow` (queries/player.ts), kept local so this file stays supabase-free. */
export interface PlayerAggregateRow {
  final_score: string | null;
  rounds_played: number;
  rounds_won: number;
  is_win: boolean;
  kills: number;
  assists: number;
  deaths: number;
  damage: number;
  map: string | null;
}

export interface PlayerAggregateStats {
  matches: number;
  wins: number;
  losses: number;
  wr: number;
  kills: number;
  assists: number;
  deaths: number;
  kd: number;
  damage: number;
  rounds_played: number;
  rounds_won: number;
  rwr: number;
  adr: number;
  kills_in_wins: number;
  deaths_in_wins: number;
  kills_in_losses: number;
  deaths_in_losses: number;
}

/**
 * Sums a player's per-match rows into career/season totals plus the four canonical derived
 * rates (via `deriveRates`) — the shared aggregation step behind PlayerView's career/season
 * summary tile, its season-history table rows, and `aggregatePlayerStatsByMap`'s per-map
 * buckets. Only rows that were actually played (`isPlayedScore` + `rounds_played > 0`) count;
 * unplayed/pre-staged rows contribute nothing.
 */
export function aggregatePlayerStats(rowsRaw: PlayerAggregateRow[]): PlayerAggregateStats {
  const rows = rowsRaw.filter((r) => isPlayedScore(r.final_score) && r.rounds_played > 0);
  const matches = rows.length;
  const wins = rows.filter((r) => r.is_win).length;
  const losses = matches - wins;
  const kills = rows.reduce((s, r) => s + r.kills, 0);
  const assists = rows.reduce((s, r) => s + r.assists, 0);
  const deaths = rows.reduce((s, r) => s + r.deaths, 0);
  const damage = rows.reduce((s, r) => s + r.damage, 0);
  const rounds_played = rows.reduce((s, r) => s + r.rounds_played, 0);
  const rounds_won = rows.reduce((s, r) => s + r.rounds_won, 0);
  const kills_in_wins = rows.reduce((s, r) => s + (r.is_win ? r.kills : 0), 0);
  const deaths_in_wins = rows.reduce((s, r) => s + (r.is_win ? r.deaths : 0), 0);
  const kills_in_losses = rows.reduce((s, r) => s + (r.is_win ? 0 : r.kills), 0);
  const deaths_in_losses = rows.reduce((s, r) => s + (r.is_win ? 0 : r.deaths), 0);
  const rates = deriveRates({
    matches_played: matches,
    matches_won: wins,
    total_kills: kills,
    total_deaths: deaths,
    total_rounds_played: rounds_played,
    total_rounds_won: rounds_won,
    total_damage: damage,
  });
  return {
    matches,
    wins,
    losses,
    wr: rates.win_rate_percentage,
    kills,
    assists,
    deaths,
    kd: rates.kd_ratio,
    damage,
    rounds_played,
    rounds_won,
    rwr: rates.rwr_percentage,
    adr: rates.overall_adr,
    kills_in_wins,
    deaths_in_wins,
    kills_in_losses,
    deaths_in_losses,
  };
}

export interface PlayerMapAggregateStats {
  map: string;
  wins: number;
  losses: number;
  wr: number;
  rwr: number;
  adr: number;
}

/**
 * Buckets a player's rows by map (via `groupByMap`, so differently-punctuated names for the
 * same map never split into separate rows) and aggregates each bucket with `aggregatePlayerStats`,
 * sorted by the canonical WR% → RWR% → ADR order (descending). Maps with zero played matches in
 * this scope are dropped rather than shown as an empty row.
 */
export function aggregatePlayerStatsByMap(rows: PlayerAggregateRow[]): PlayerMapAggregateStats[] {
  const buckets = groupByMap(rows, (r) => r.map);
  const out: PlayerMapAggregateStats[] = [];
  for (const { display, rows: list } of buckets.values()) {
    const a = aggregatePlayerStats(list);
    if (a.matches === 0) continue;
    out.push({ map: display, wins: a.wins, losses: a.losses, wr: a.wr, rwr: a.rwr, adr: a.adr });
  }
  return out.sort((a, b) => b.wr - a.wr || b.rwr - a.rwr || b.adr - a.adr);
}
