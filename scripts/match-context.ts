// Prints advanced context for one or more matches as JSON: season sabremetric "+" stats (per
// docs/calculations.md), raw accuracy/mechanics stats, current EHOG ratings + projected deltas
// for representative scorelines, and career head-to-head (rival/duo) records for the match's
// participants. Reuses the app's own query/rating logic (queries.ts, ehog.ts) instead of
// reimplementing the aggregation, so results can't drift from what the site itself shows.
//
// Usage: npx tsx scripts/match-context.ts <matchId> [<matchId> ...]

import { supabase } from '../src/lib/supabase';
import {
  getAllSabremetrics, getPlayerRatings, getH2HData, getAllSeasonMedalists,
  aggregateRows, computeLeagueAverages, computePlusStats,
  type TrophyEntry, type AggregatedSab, type LeagueAverages,
} from '../src/lib/queries';
import { projectRatingDeltas, type PlayerRating, type RatingProjection } from '../src/lib/ehog';
import { findDuo, findRival } from '../src/lib/util';

interface MatchRow {
  id: number;
  week_id: number;
  final_score: string | null;
  is_feature_match: boolean;
  is_playoff_game: boolean;
  scheduled_at: string;
}

interface PmsRow {
  player_id: number;
  faction: 'SHIRTS' | 'SKINS';
  kills: number;
  deaths: number;
  adr: number;
  is_win: boolean;
}

function safeDiv(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

interface ReportStats {
  sampleMatches: number;
  kprPlus: number | null;
  aprPlus: number | null;
  dprPlus: number | null;
  kdrPlus: number | null;
  adrPlus: number | null;
  entryPlus: number | null;
  kastPlus: number | null;
  tradePlus: number | null;
  objectivePlus: number | null;
  utilityPlus: number | null;
  clutchPlus: number | null;
  chokePlus: number | null;
  aimPlus: number | null;
  sprayPlus: number | null;
  mechanics: {
    accuracy: number | null;
    headAccuracy: number | null;
    counterStrafePct: number | null;
    sprayAccuracy: number | null;
    ctSmokesBlockingPct: number | null;
    unusedUtilPerDeath: number | null;
  };
}

/** Decorates the shared Plus-stat composite (src/lib/queries/sabremetrics.ts — the same one
 *  SabremetricsLeaderboardView.tsx renders, so results can't drift from the site) with this
 *  script's own JSON-report extras: a sample-size field and raw mechanics rates, neither of which
 *  the live leaderboard needs. Field names keep the existing "*Plus" JSON shape the chirp skill
 *  (.claude/skills/chirp/SKILL.md) already depends on. */
function reportStats(agg: AggregatedSab, la: LeagueAverages): ReportStats {
  const plus = computePlusStats(agg, la);
  return {
    sampleMatches: agg.matches,
    kprPlus: plus.kpr,
    aprPlus: plus.apr,
    dprPlus: plus.dpr,
    kdrPlus: plus.kdr,
    adrPlus: plus.adr,
    entryPlus: plus.entry,
    kastPlus: plus.kast,
    tradePlus: plus.trade,
    objectivePlus: plus.objective,
    utilityPlus: plus.utility,
    clutchPlus: plus.clutch,
    chokePlus: plus.choke,
    aimPlus: plus.aim,
    sprayPlus: plus.spray,
    mechanics: {
      accuracy: safeDiv(agg.shots_hit, agg.shots_fired),
      headAccuracy: safeDiv(agg.headshot_hits_no_awp, agg.shots_hit_no_awp),
      counterStrafePct: safeDiv(agg.counter_strafe_good_shots, agg.counter_strafe_shots),
      sprayAccuracy: safeDiv(agg.spray_shots_hit, agg.spray_shots_fired),
      ctSmokesBlockingPct: safeDiv(agg.smokes_blocking_push, agg.ct_smokes_thrown),
      unusedUtilPerDeath: safeDiv(agg.unused_util_value_on_death_total, agg.deaths),
    },
  };
}

/** A roster player whose season has no demo-parsed matches yet (early season, or this very match
 *  hasn't been parsed) — `aggregateRows()` never produces an entry for them at all, so there's
 *  nothing to hand `computePlusStats()`. Report it as explicitly no-data rather than fabricating
 *  ratios from an all-zero aggregate. */
function emptyReportStats(): ReportStats {
  return {
    sampleMatches: 0,
    kprPlus: null, aprPlus: null, dprPlus: null, kdrPlus: null, adrPlus: null,
    entryPlus: null, kastPlus: null, tradePlus: null, objectivePlus: null,
    utilityPlus: null, clutchPlus: null, chokePlus: null, aimPlus: null, sprayPlus: null,
    mechanics: {
      accuracy: null, headAccuracy: null, counterStrafePct: null,
      sprayAccuracy: null, ctSmokesBlockingPct: null, unusedUtilPerDeath: null,
    },
  };
}

async function buildContext(matchId: number, trophiesByPlayer: Map<number, TrophyEntry[]>) {
  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .select('id, week_id, final_score, is_feature_match, is_playoff_game, scheduled_at')
    .eq('id', matchId)
    .maybeSingle();
  if (matchErr) throw matchErr;
  if (!match) return { matchId, error: 'not found' };
  const m = match as MatchRow;

  const { data: week } = await supabase.from('weeks').select('season_id, week_number').eq('id', m.week_id).maybeSingle();
  const seasonId = (week as { season_id: number } | null)?.season_id;
  if (seasonId == null) return { matchId, error: 'no season resolved' };
  const { data: season } = await supabase.from('seasons').select('name, is_gauntlet, target_win_rounds').eq('id', seasonId).maybeSingle();
  const seasonRow = season as { name: string; is_gauntlet: boolean; target_win_rounds: number } | null;
  if (seasonRow?.is_gauntlet) {
    return { matchId, error: 'gauntlet match — sabremetrics/EHOG projection/H2H career stats are season-scoped and not wired up for gauntlet play yet' };
  }
  const targetWinRounds = seasonRow?.target_win_rounds ?? 13;

  const { data: pms } = await supabase
    .from('player_match_stats')
    .select('player_id, faction, kills, deaths, adr, is_win')
    .eq('match_id', matchId);
  const roster = (pms ?? []) as PmsRow[];
  const playerIds = roster.map((r) => r.player_id);

  const [sabSeasonRows, ratings, h2h] = await Promise.all([
    getAllSabremetrics(seasonId),
    getPlayerRatings(playerIds),
    getH2HData({ filter: 'career', includeRegular: true, includeGauntlet: true }),
  ]);

  const seasonRows = sabSeasonRows; // already season-filtered by getAllSabremetrics(seasonId)
  const leagueAggregated = aggregateRows(seasonRows);
  const leagueAverages = computeLeagueAverages(leagueAggregated);
  const aggByPlayer = new Map(leagueAggregated.map((a) => [a.player_id, a]));
  const sabByPlayer: Record<number, ReportStats> = {};
  for (const pid of playerIds) {
    const agg = aggByPlayer.get(pid);
    sabByPlayer[pid] = agg ? reportStats(agg, leagueAverages) : emptyReportStats();
  }

  const ratingByPlayer = new Map(ratings.map((r) => [r.playerId, r]));
  const shirts: PlayerRating[] = roster.filter((r) => r.faction === 'SHIRTS').map((r) => {
    const rt = ratingByPlayer.get(r.player_id)!;
    return { playerId: r.player_id, mu: rt.mu, sigma: rt.sigma, ehogRating: rt.ehogRating };
  });
  const skins: PlayerRating[] = roster.filter((r) => r.faction === 'SKINS').map((r) => {
    const rt = ratingByPlayer.get(r.player_id)!;
    return { playerId: r.player_id, mu: rt.mu, sigma: rt.sigma, ehogRating: rt.ehogRating };
  });
  let projections: RatingProjection[] = [];
  if (shirts.length === 2 && skins.length === 2) {
    projections = projectRatingDeltas(shirts, skins, targetWinRounds);
  }

  const pairs: { a: number; b: number; relation: 'rival' | 'duo' }[] = [];
  for (let i = 0; i < roster.length; i++) {
    for (let j = i + 1; j < roster.length; j++) {
      const a = roster[i], b = roster[j];
      pairs.push({ a: a.player_id, b: b.player_id, relation: a.faction === b.faction ? 'duo' : 'rival' });
    }
  }
  const h2hForMatch = pairs.map((p) => {
    if (p.relation === 'duo') {
      return { ...p, stats: findDuo(h2h.duos, p.a, p.b) ?? null };
    }
    return { ...p, stats: findRival(h2h.rivals, p.a, p.b) ?? null };
  });

  return {
    matchId: m.id,
    seasonId,
    weekNumber: (week as { week_number: number }).week_number,
    isFeatureMatch: m.is_feature_match,
    scheduledAt: m.scheduled_at,
    targetWinRounds,
    roster: roster.map((r) => ({
      playerId: r.player_id,
      faction: r.faction,
      currentEhog: ratingByPlayer.get(r.player_id)?.ehogRating ?? null,
      trophyCase: trophiesByPlayer.get(r.player_id) ?? [],
    })),
    seasonSabremetrics: sabByPlayer,
    ehogProjections: projections,
    h2h: h2hForMatch,
  };
}

async function main() {
  const matchIds = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
  if (matchIds.length === 0) {
    console.error('Usage: npx tsx scripts/match-context.ts <matchId> [<matchId> ...]');
    process.exit(1);
  }
  const trophiesByPlayer = await getAllSeasonMedalists();
  const contexts = await Promise.all(matchIds.map((id) => buildContext(id, trophiesByPlayer)));
  console.log(JSON.stringify(contexts, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
