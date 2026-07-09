// Prints advanced context for one or more matches as JSON: season sabremetric "+" stats (per
// docs/calculations.md), raw accuracy/mechanics stats, current EHOG ratings + projected deltas
// for representative scorelines, and career head-to-head (rival/duo) records for the match's
// participants. Reuses the app's own query/rating logic (queries.ts, ehog.ts) instead of
// reimplementing the aggregation, so results can't drift from what the site itself shows.
//
// Usage: npx tsx scripts/match-context.ts <matchId> [<matchId> ...]

import { supabase } from '../src/lib/supabase';
import { getAllSabremetrics, getPlayerRatings, getH2HData, getAllSeasonMedalists, type SabremetricMatchRow, type TrophyEntry } from '../src/lib/queries';
import { projectRatingDeltas, type PlayerRating, type RatingProjection } from '../src/lib/ehog';
import type { DuoStats, H2HStats } from '../src/lib/util';

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

function samePair(aId: number, bId: number, x: number, y: number): boolean {
  return (aId === x && bId === y) || (aId === y && bId === x);
}

/** Sum of sums, not average of per-match ratios — matches how `overall_adr` etc. are aggregated
 *  elsewhere in this codebase (see CLAUDE.md's ADR precision note). */
function aggregateSabTotals(rows: SabremetricMatchRow[]) {
  const totals = {
    matches: 0, rounds: 0, kills: 0, deaths: 0, assists: 0, damage: 0,
    openingKills: 0, openingDeaths: 0, kastRounds: 0,
    clutch1v1Attempts: 0, clutch1v1Wins: 0, clutch1v2Attempts: 0, clutch1v2Wins: 0,
    flashAssists: 0, utilityDamage: 0, plants: 0, defuses: 0,
    shotsFired: 0, shotsHit: 0, headshotHits: 0,
    counterStrafeShots: 0, counterStrafeGoodShots: 0,
    sprayShotsFired: 0, sprayShotsHit: 0,
  };
  for (const r of rows) {
    totals.matches += 1;
    totals.rounds += r.rounds_played;
    totals.kills += r.sab.kills_ct + r.sab.kills_t;
    totals.deaths += r.sab.deaths_ct + r.sab.deaths_t;
    totals.assists += r.sab.assists_ct + r.sab.assists_t;
    totals.damage += r.sab.damage_ct + r.sab.damage_t;
    totals.openingKills += r.sab.opening_kills;
    totals.openingDeaths += r.sab.opening_deaths;
    totals.kastRounds += r.sab.kast_rounds;
    totals.clutch1v1Attempts += r.sab.clutch_1v1_attempts;
    totals.clutch1v1Wins += r.sab.clutch_1v1_wins;
    totals.clutch1v2Attempts += r.sab.clutch_1v2_attempts;
    totals.clutch1v2Wins += r.sab.clutch_1v2_wins;
    totals.flashAssists += r.sab.flash_assists;
    totals.utilityDamage += r.sab.utility_damage;
    totals.plants += r.sab.plants;
    totals.defuses += r.sab.defuses;
    totals.shotsFired += r.sab.shots_fired;
    totals.shotsHit += r.sab.shots_hit;
    totals.headshotHits += r.sab.headshot_hits;
    totals.counterStrafeShots += r.sab.counter_strafe_shots;
    totals.counterStrafeGoodShots += r.sab.counter_strafe_good_shots;
    totals.sprayShotsFired += r.sab.spray_shots_fired;
    totals.sprayShotsHit += r.sab.spray_shots_hit;
  }
  return totals;
}

type SabTotals = ReturnType<typeof aggregateSabTotals>;

function safeDiv(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

/** "+" stats per docs/calculations.md — player rate / league rate for that season.
 *  Choke+ and the Player Rating composite are intentionally omitted: Choke+ needs 2v1 clutch
 *  data this schema doesn't collect yet, and Player Rating is documented as not implemented. */
function plusStats(player: SabTotals, league: SabTotals) {
  const ratio = (p: number | null, l: number | null) => (p != null && l != null && l !== 0 ? p / l : null);
  const pKpr = safeDiv(player.kills, player.rounds), lKpr = safeDiv(league.kills, league.rounds);
  const pApr = safeDiv(player.assists, player.rounds), lApr = safeDiv(league.assists, league.rounds);
  const pDpr = safeDiv(player.deaths, player.rounds), lDpr = safeDiv(league.deaths, league.rounds);
  const pKdr = safeDiv(player.kills, player.deaths), lKdr = safeDiv(league.kills, league.deaths);
  const pAdr = safeDiv(player.damage, player.rounds), lAdr = safeDiv(league.damage, league.rounds);
  const pEntry = safeDiv(player.openingKills, player.openingKills + player.openingDeaths);
  const lEntry = safeDiv(league.openingKills, league.openingKills + league.openingDeaths);
  const pKast = safeDiv(player.kastRounds, player.rounds), lKast = safeDiv(league.kastRounds, league.rounds);
  const pObj = 2 * player.plants + 3 * player.defuses;
  const lObj = 2 * league.plants + 3 * league.defuses;
  const pUtil = player.flashAssists + player.utilityDamage / 50;
  const lUtil = league.flashAssists + league.utilityDamage / 50;
  const pClutch = player.clutch1v1Wins + 3 * player.clutch1v2Wins;
  const lClutch = league.clutch1v1Wins + 3 * league.clutch1v2Wins;
  return {
    sampleMatches: player.matches,
    kprPlus: ratio(pKpr, lKpr),
    aprPlus: ratio(pApr, lApr),
    dprPlus: ratio(pDpr, lDpr),
    kdrPlus: ratio(pKdr, lKdr),
    adrPlus: ratio(pAdr, lAdr),
    entryPlus: ratio(pEntry, lEntry),
    kastPlus: ratio(pKast, lKast),
    objectivePlus: ratio(pObj, lObj),
    utilityPlus: ratio(pUtil, lUtil),
    clutchPlus: ratio(pClutch, lClutch),
    mechanics: {
      accuracy: safeDiv(player.shotsHit, player.shotsFired),
      headAccuracy: safeDiv(player.headshotHits, player.shotsHit),
      counterStrafePct: safeDiv(player.counterStrafeGoodShots, player.counterStrafeShots),
      sprayAccuracy: safeDiv(player.sprayShotsHit, player.sprayShotsFired),
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
  const leagueTotals = aggregateSabTotals(seasonRows);
  const sabByPlayer: Record<number, ReturnType<typeof plusStats>> = {};
  for (const pid of playerIds) {
    const rows = seasonRows.filter((r) => r.player_id === pid);
    sabByPlayer[pid] = plusStats(aggregateSabTotals(rows), leagueTotals);
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
      const found = h2h.duos.find((d: DuoStats) => samePair(d.playerA, d.playerB, p.a, p.b));
      return { ...p, stats: found ?? null };
    }
    const found = h2h.rivals.find((r: H2HStats) => samePair(r.playerA, r.playerB, p.a, p.b));
    return { ...p, stats: found ?? null };
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
