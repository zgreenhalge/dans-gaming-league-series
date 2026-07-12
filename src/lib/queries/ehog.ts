import { supabase } from '../supabase';
import { extractSeasonNumber } from '../util';
import { MU_DEFAULT, SIGMA_DEFAULT, DEFAULT_EHOG, fromEhog } from '../ehog';


// ---------------------------------------------------------------------------
// EHOG rating data
// ---------------------------------------------------------------------------

const SUPABASE_IN_BATCH = 200;

async function batchedIn<T>(
  table: string,
  column: string,
  ids: number[],
  select: string,
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < ids.length; i += SUPABASE_IN_BATCH) {
    const chunk = ids.slice(i, i + SUPABASE_IN_BATCH);
    const { data, error } = await supabase.from(table).select(select).in(column, chunk);
    if (error) throw error;
    if (data) results.push(...(data as T[]));
  }
  return results;
}

interface MatchContext {
  matchById: Map<number, { match_number: number; week_id: number }>;
  weekById: Map<number, { season_id: number; week_number: number }>;
  seasonById: Map<number, { name: string; is_gauntlet: boolean }>;
}

async function resolveMatchContext(matchIds: number[]): Promise<MatchContext> {
  const matches = await batchedIn<{ id: number; match_number: number; week_id: number }>(
    'matches', 'id', matchIds, 'id, match_number, week_id',
  );
  const matchById = new Map(matches.map((m) => [m.id, m]));

  const weekIds = Array.from(new Set(matches.map((m) => m.week_id)));
  const weeks = await batchedIn<{ id: number; season_id: number; week_number: number }>(
    'weeks', 'id', weekIds, 'id, season_id, week_number',
  );
  const weekById = new Map(weeks.map((w) => [w.id, w]));

  const seasonIds = Array.from(new Set(weeks.map((w) => w.season_id)));
  const seasons = await batchedIn<{ id: number; name: string; is_gauntlet: boolean }>(
    'seasons', 'id', seasonIds, 'id, name, is_gauntlet',
  );
  const seasonById = new Map(seasons.map((s) => [s.id, s]));

  return { matchById, weekById, seasonById };
}

function matchSeasonInfo(
  matchId: number,
  ctx: MatchContext,
): { seasonName: string; seasonNumber: number | null; isGauntlet: boolean; weekNumber: number; matchNumber: number } {
  const m = ctx.matchById.get(matchId);
  const w = m ? ctx.weekById.get(m.week_id) : undefined;
  const s = w ? ctx.seasonById.get(w.season_id) : undefined;
  return {
    seasonName: s?.name ?? '',
    seasonNumber: s ? extractSeasonNumber(s.name) : null,
    isGauntlet: s?.is_gauntlet ?? false,
    weekNumber: w?.week_number ?? 0,
    matchNumber: m?.match_number ?? 0,
  };
}

export interface EhogRatingPoint {
  matchId: number;
  sequenceIndex: number;
  ehogRating: number;
  ratingDelta: number;
  seasonName: string;
  seasonNumber: number | null;
  isGauntlet: boolean;
  weekNumber: number;
  matchNumber: number;
}

export interface EhogPlayerData {
  currentRating: number | null;
  history: EhogRatingPoint[];
}

export async function getPlayerEhogRating(playerId: number): Promise<EhogPlayerData> {
  const [currentRes, historyRes] = await Promise.all([
    supabase
      .from('player_current_ratings')
      .select('ehog_v1')
      .eq('player_id', playerId)
      .maybeSingle(),
    supabase
      .from('player_rating_history')
      .select('match_id, sequence_index, ehog_rating, rating_delta')
      .eq('player_id', playerId)
      .eq('formula_version', 'ehog_v1')
      .order('sequence_index', { ascending: true }),
  ]);
  if (currentRes.error) throw currentRes.error;
  if (historyRes.error) throw historyRes.error;

  const currentRating: number | null = currentRes.data?.ehog_v1 ?? null;
  const rows = historyRes.data ?? [];

  if (rows.length === 0) return { currentRating, history: [] };

  const ctx = await resolveMatchContext(rows.map((r) => r.match_id));

  const history: EhogRatingPoint[] = rows.map((r) => ({
    matchId: r.match_id,
    sequenceIndex: r.sequence_index,
    ehogRating: r.ehog_rating,
    ratingDelta: r.rating_delta,
    ...matchSeasonInfo(r.match_id, ctx),
  }));

  return { currentRating, history };
}

export interface EhogSnapshotRow {
  playerId: number;
  ehogRating: number;
  sequenceIndex: number;
  seasonNumber: number | null;
  isGauntlet: boolean;
}

export async function getAllEhogSnapshots(): Promise<EhogSnapshotRow[]> {
  const { data, error } = await supabase
    .from('player_rating_history')
    .select('player_id, ehog_rating, sequence_index, match_id')
    .eq('formula_version', 'ehog_v1')
    .order('sequence_index', { ascending: true });
  if (error) throw error;
  if (!data || data.length === 0) return [];

  const matchIds = Array.from(new Set(data.map((r) => r.match_id)));
  const ctx = await resolveMatchContext(matchIds);

  // Reduce to latest snapshot per player per (seasonNumber, isGauntlet) segment
  const latest = new Map<string, EhogSnapshotRow>();
  for (const r of data) {
    const info = matchSeasonInfo(r.match_id, ctx);
    const key = `${r.player_id}:${info.seasonNumber}:${info.isGauntlet}`;
    const prev = latest.get(key);
    if (!prev || r.sequence_index > prev.sequenceIndex) {
      latest.set(key, {
        playerId: r.player_id,
        ehogRating: r.ehog_rating,
        sequenceIndex: r.sequence_index,
        seasonNumber: info.seasonNumber,
        isGauntlet: info.isGauntlet,
      });
    }
  }
  return Array.from(latest.values());
}

export async function getSeasonEhogRatings(seasonId: number): Promise<Record<number, number>> {
  const { data: weeks, error: wErr } = await supabase
    .from('weeks')
    .select('id')
    .eq('season_id', seasonId);
  if (wErr) throw wErr;
  if (!weeks || weeks.length === 0) return {};

  const weekIds = weeks.map((w) => w.id);
  const matches = await batchedIn<{ id: number }>('matches', 'week_id', weekIds, 'id');
  if (matches.length === 0) return {};

  const matchIds = matches.map((m) => m.id);
  const rows: { player_id: number; ehog_rating: number; sequence_index: number }[] = [];
  for (let i = 0; i < matchIds.length; i += SUPABASE_IN_BATCH) {
    const chunk = matchIds.slice(i, i + SUPABASE_IN_BATCH);
    const { data, error } = await supabase
      .from('player_rating_history')
      .select('player_id, ehog_rating, sequence_index')
      .eq('formula_version', 'ehog_v1')
      .in('match_id', chunk);
    if (error) throw error;
    if (data) rows.push(...data);
  }

  const latest: Record<number, { rating: number; seq: number }> = {};
  for (const row of rows) {
    const prev = latest[row.player_id];
    if (!prev || row.sequence_index > prev.seq) {
      latest[row.player_id] = { rating: row.ehog_rating, seq: row.sequence_index };
    }
  }
  const result: Record<number, number> = {};
  for (const [pid, val] of Object.entries(latest)) result[Number(pid)] = val.rating;
  return result;
}

export async function getBatchMatchRatingDeltas(matchIds: number[]): Promise<Map<number, Map<number, number>>> {
  if (matchIds.length === 0) return new Map();
  const rows: { match_id: number; player_id: number; rating_delta: number; ehog_rating: number; sequence_index: number }[] = [];
  for (let i = 0; i < matchIds.length; i += SUPABASE_IN_BATCH) {
    const chunk = matchIds.slice(i, i + SUPABASE_IN_BATCH);
    const { data, error } = await supabase
      .from('player_rating_history')
      .select('match_id, player_id, rating_delta, ehog_rating, sequence_index')
      .in('match_id', chunk)
      .eq('formula_version', 'ehog_v1');
    if (error) throw error;
    if (data) rows.push(...data);
  }
  const result = new Map<number, Map<number, number>>();
  for (const r of rows) {
    let inner = result.get(r.match_id);
    if (!inner) { inner = new Map(); result.set(r.match_id, inner); }
    inner.set(r.player_id, r.rating_delta);
  }
  return result;
}

export async function getMatchRatingDeltas(matchId: number): Promise<Map<number, number>> {
  const { data, error } = await supabase
    .from('player_rating_history')
    .select('player_id, rating_delta, ehog_rating, sequence_index')
    .eq('match_id', matchId)
    .eq('formula_version', 'ehog_v1');
  if (error) throw error;
  const map = new Map<number, number>();
  for (const row of data ?? []) {
    map.set(row.player_id, row.rating_delta);
  }
  return map;
}

export interface PlayerMuSigma {
  playerId: number;
  mu: number;
  sigma: number;
  ehogRating: number;
}

export async function getPlayerRatings(playerIds: number[]): Promise<PlayerMuSigma[]> {
  if (playerIds.length === 0) return [];
  const rows = await batchedIn<{ player_id: number; mu: number; sigma: number; ehog_rating: number; sequence_index: number }>(
    'player_rating_history', 'player_id', playerIds,
    'player_id, mu, sigma, ehog_rating, sequence_index',
  );

  const latest = new Map<number, { mu: number; sigma: number; ehogRating: number; seq: number }>();
  for (const r of rows) {
    const prev = latest.get(r.player_id);
    if (!prev || r.sequence_index > prev.seq) {
      latest.set(r.player_id, { mu: r.mu, sigma: r.sigma, ehogRating: r.ehog_rating, seq: r.sequence_index });
    }
  }

  // Players with no rating_history yet may still have a configured seed_ehog (a known new
  // player's starting rating) — use that instead of the global default for their preview.
  const unratedIds = playerIds.filter((pid) => !latest.has(pid));
  const seedRows = unratedIds.length > 0
    ? await batchedIn<{ id: number; seed_ehog: number | null }>('players', 'id', unratedIds, 'id, seed_ehog')
    : [];
  const seedByPlayer = new Map(
    seedRows.filter((r) => r.seed_ehog != null).map((r) => [r.id, r.seed_ehog as number]),
  );

  return playerIds.map((pid) => {
    const s = latest.get(pid);
    if (s) return { playerId: pid, mu: s.mu, sigma: s.sigma, ehogRating: s.ehogRating };
    const seedEhog = seedByPlayer.get(pid);
    if (seedEhog != null) {
      return { playerId: pid, mu: fromEhog(seedEhog, SIGMA_DEFAULT), sigma: SIGMA_DEFAULT, ehogRating: seedEhog };
    }
    return { playerId: pid, mu: MU_DEFAULT, sigma: SIGMA_DEFAULT, ehogRating: DEFAULT_EHOG };
  });
}
