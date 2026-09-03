import { parseScore, compareMatchRefDesc, isPlayedScore } from './util';

// ─── H2H aggregation ─────────────────────────────────────────────────────────
//
// Pure duo/rival aggregation core, shared by `getH2HData` (queries/h2h.ts, DB-backed —
// used where no live season filter needs to react client-side) and the Statistics
// / Map pages (which already hold full `MapMatchRow[]` client-side for their other
// tabs and compute H2H straight from it so the H2H tab honors the same season
// filter). Lives in its own module (not queries/h2h.ts) so it stays importable
// from client components without pulling in the supabase client.

/** One match `playerA`+`playerB` played as partners (same faction). */
export interface DuoMatchSummary {
  matchId: number;
  seasonNumber: number | null;
  isGauntlet: boolean;
  weekNumber: number;
  matchNumber: number;
  map: string | null;
  pickedBy: 'SHIRTS' | 'SKINS' | null;
  startingSide: 'CT' | 'T' | null;
  score: { duo: number; opponents: number } | null;
  won: boolean | null;
  /** playerA + playerB's roster for this match. */
  team: MatchRosterPlayer[];
  opponents: MatchRosterPlayer[];
}

/** One match `playerA` and `playerB` met as opponents (different factions). */
export interface RivalMatchSummary {
  matchId: number;
  seasonNumber: number | null;
  isGauntlet: boolean;
  weekNumber: number;
  matchNumber: number;
  map: string | null;
  pickedBy: 'SHIRTS' | 'SKINS' | null;
  startingSide: 'CT' | 'T' | null;
  score: { a: number; b: number } | null;
  aWon: boolean | null;
  /** playerA's roster (playerA + their 2v2 teammate) for this match. */
  aTeam: MatchRosterPlayer[];
  /** playerB's roster (playerB + their 2v2 teammate) for this match. */
  bTeam: MatchRosterPlayer[];
}

/** A roster player's stat line for a single match — mirrors `MatchCardPlayer` in MatchCard.tsx. */
export interface MatchRosterPlayer {
  player_id: number;
  player_name: string;
  kills: number;
  assists: number;
  deaths: number;
  adr: number;
}

/** A pair's aggregated record on a single map, across every meeting on it. */
export interface H2HMapStat {
  map: string;
  games: number;
  /** duo: wins as a pair | rival: playerA's wins on this map */
  wins: number;
  losses: number;
  roundsWon: number;
  roundsPlayed: number;
  /** duo: combined ADR (both players) | rival: playerA's ADR */
  aAdr: number;
  /** duo: unused (0) | rival: playerB's ADR */
  bAdr: number;
}

export interface DuoStats {
  playerA: number;
  playerB: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  combinedAdr: number;
  combinedKills: number;
  combinedAssists: number;
  combinedDeaths: number;
  roundsWon: number;
  roundsPlayed: number;
  aStats: H2HPlayerStats;
  bStats: H2HPlayerStats;
  bestMap: string | null;
  mapBreakdown: H2HMapStat[];
  matches: DuoMatchSummary[];
}

/** A player's aggregated performance across their meetings with a given rival. */
export interface H2HPlayerStats {
  kills: number;
  assists: number;
  deaths: number;
  adr: number;
  rwr: number;
  roundsWon: number;
  roundsPlayed: number;
}

export interface H2HStats {
  playerA: number;
  playerB: number;
  meetings: number;
  aWins: number;
  bWins: number;
  lastMap: string | null;
  aStats: H2HPlayerStats;
  bStats: H2HPlayerStats;
  mapBreakdown: H2HMapStat[];
  matches: RivalMatchSummary[];
}

export interface H2HData {
  duos: DuoStats[];
  rivals: H2HStats[];
  players: { id: number; name: string; steam_avatar_url: string | null }[];
}

/** One match's roster, in the shape `computeH2H` needs — a flattened `player_match_stats` row. */
export interface H2HRosterRow {
  player_id: number;
  faction: 'SHIRTS' | 'SKINS';
  kills: number;
  assists: number;
  deaths: number;
  adr: number;
  is_win: boolean;
  rounds_won: number;
  rounds_played: number;
}

/** One played match, resolved to the fields `computeH2H` needs to aggregate and label it. */
export interface H2HMatchInput {
  matchId: number;
  weekNumber: number;
  matchNumber: number;
  seasonNumber: number | null;
  isGauntlet: boolean;
  map: string | null;
  /** Who picked the played map — see "Who picked" in docs/glossary.md. `null` for gauntlet matches (no veto data). */
  pickedBy: 'SHIRTS' | 'SKINS' | null;
  /** Skins' starting side for the played map. `null` for gauntlet matches (no veto data). */
  startingSide: 'CT' | 'T' | null;
  finalScore: string | null;
  roster: H2HRosterRow[];
}

function h2hPairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

interface H2HRivalPlayerAgg {
  games: number;
  kills: number;
  assists: number;
  deaths: number;
  adrSum: number;
  roundsWon: number;
  roundsPlayed: number;
}

function emptyH2HRivalPlayerAgg(): H2HRivalPlayerAgg {
  return { games: 0, kills: 0, assists: 0, deaths: 0, adrSum: 0, roundsWon: 0, roundsPlayed: 0 };
}

function finalizeH2HPlayerStats(agg: H2HRivalPlayerAgg): H2HPlayerStats {
  return {
    kills: agg.kills,
    assists: agg.assists,
    deaths: agg.deaths,
    adr: agg.games > 0 ? agg.adrSum / agg.games : 0,
    rwr: agg.roundsPlayed > 0 ? (agg.roundsWon / agg.roundsPlayed) * 100 : 0,
    roundsWon: agg.roundsWon,
    roundsPlayed: agg.roundsPlayed,
  };
}

interface H2HMapAgg {
  games: number;
  wins: number;
  losses: number;
  roundsWon: number;
  roundsPlayed: number;
  aAdrSum: number;
  bAdrSum: number;
}

function emptyH2HMapAgg(): H2HMapAgg {
  return { games: 0, wins: 0, losses: 0, roundsWon: 0, roundsPlayed: 0, aAdrSum: 0, bAdrSum: 0 };
}

/** Finalizes a per-map aggregation map into a `games`-descending list. */
function finalizeMapBreakdown(mapTotals: Map<string, H2HMapAgg>): H2HMapStat[] {
  return [...mapTotals.entries()]
    .map(([map, t]) => ({
      map,
      games: t.games,
      wins: t.wins,
      losses: t.losses,
      roundsWon: t.roundsWon,
      roundsPlayed: t.roundsPlayed,
      aAdr: t.games > 0 ? t.aAdrSum / t.games : 0,
      bAdr: t.games > 0 ? t.bAdrSum / t.games : 0,
    }))
    .sort((x, y) => y.games - x.games);
}

interface H2HDuoAgg {
  a: number;
  b: number;
  games: number;
  wins: number;
  losses: number;
  adrSum: number;
  kills: number;
  assists: number;
  deaths: number;
  roundsWon: number;
  roundsPlayed: number;
  aStats: H2HRivalPlayerAgg;
  bStats: H2HRivalPlayerAgg;
  mapTotals: Map<string, H2HMapAgg>;
  matches: DuoMatchSummary[];
}

interface H2HRivalAgg {
  a: number;
  b: number;
  meetings: number;
  aWins: number;
  bWins: number;
  aStats: H2HRivalPlayerAgg;
  bStats: H2HRivalPlayerAgg;
  mapTotals: Map<string, H2HMapAgg>;
  matches: RivalMatchSummary[];
}

/**
 * The map a duo has won together most often. If multiple maps are tied for
 * the most wins, there's no clear "best" — return null rather than picking
 * one arbitrarily.
 */
function bestH2HMapFor(mapTotals: Map<string, { games: number; wins: number }>): string | null {
  let bestMap: string | null = null;
  let bestWins = -1;
  let tied = false;
  for (const [map, t] of mapTotals) {
    if (t.wins > bestWins) {
      bestMap = map;
      bestWins = t.wins;
      tied = false;
    } else if (t.wins === bestWins) {
      tied = true;
    }
  }
  return tied ? null : bestMap;
}

/**
 * Computes head-to-head relationship data — partner records (`duos`) and
 * opponent records (`rivals`) — from a set of already-resolved played matches.
 * Only played matches should be passed in (callers filter with `isPlayedScore`
 * beforehand, since what counts as "played" and which seasons are in scope
 * varies by caller).
 */
export function computeH2H(
  matches: H2HMatchInput[],
  players: Map<number, { name: string; steam_avatar_url: string | null }>,
): H2HData {
  const duoAgg = new Map<string, H2HDuoAgg>();
  const rivalAgg = new Map<string, H2HRivalAgg>();
  const playerIds = new Set<number>();

  function getDuo(x: H2HRosterRow, y: H2HRosterRow): H2HDuoAgg {
    const [a, b] = x.player_id < y.player_id ? [x.player_id, y.player_id] : [y.player_id, x.player_id];
    const key = h2hPairKey(a, b);
    let agg = duoAgg.get(key);
    if (!agg) {
      agg = { a, b, games: 0, wins: 0, losses: 0, adrSum: 0, kills: 0, assists: 0, deaths: 0, roundsWon: 0, roundsPlayed: 0, aStats: emptyH2HRivalPlayerAgg(), bStats: emptyH2HRivalPlayerAgg(), mapTotals: new Map(), matches: [] };
      duoAgg.set(key, agg);
    }
    return agg;
  }

  function getRival(x: H2HRosterRow, y: H2HRosterRow): H2HRivalAgg {
    const [a, b] = x.player_id < y.player_id ? [x.player_id, y.player_id] : [y.player_id, x.player_id];
    const key = h2hPairKey(a, b);
    let agg = rivalAgg.get(key);
    if (!agg) {
      agg = { a, b, meetings: 0, aWins: 0, bWins: 0, aStats: emptyH2HRivalPlayerAgg(), bStats: emptyH2HRivalPlayerAgg(), mapTotals: new Map(), matches: [] };
      rivalAgg.set(key, agg);
    }
    return agg;
  }

  const toRosterPlayer = (row: H2HRosterRow): MatchRosterPlayer => ({
    player_id: row.player_id,
    player_name: players.get(row.player_id)?.name ?? `#${row.player_id}`,
    kills: row.kills,
    assists: row.assists ?? 0,
    deaths: row.deaths,
    adr: row.adr,
  });

  for (const m of matches) {
    const roster = m.roster;
    if (roster.length === 0) continue;
    for (const r of roster) playerIds.add(r.player_id);

    // Partner/opponent grouping is purely faction-based: two players are
    // partners if they share a `faction` (SHIRTS/SKINS) in a match, opponents
    // if they don't. There's no explicit "duo"/"team" entity in the schema —
    // this only produces correct results because the format is always 2v2
    // Wingman. Revisit if the format ever changes.
    const shirts = roster.filter((r) => r.faction === 'SHIRTS');
    const skins = roster.filter((r) => r.faction === 'SKINS');
    const parsedScore = parseScore(m.finalScore);
    const playedMap = m.map;

    const teams = [
      { roster: shirts, opponents: skins, ourScore: parsedScore?.shirts ?? null, theirScore: parsedScore?.skins ?? null },
      { roster: skins, opponents: shirts, ourScore: parsedScore?.skins ?? null, theirScore: parsedScore?.shirts ?? null },
    ];
    for (const { roster: team, opponents, ourScore, theirScore } of teams) {
      for (let i = 0; i < team.length; i++) {
        for (let j = i + 1; j < team.length; j++) {
          const x = team[i];
          const y = team[j];
          const agg = getDuo(x, y);
          agg.games += 1;
          if (x.is_win) agg.wins += 1;
          else agg.losses += 1;
          agg.adrSum += x.adr + y.adr;
          agg.kills += x.kills + y.kills;
          agg.assists += (x.assists ?? 0) + (y.assists ?? 0);
          agg.deaths += x.deaths + y.deaths;
          // x and y are teammates, so they share identical round totals for this match — count once.
          agg.roundsWon += x.rounds_won;
          agg.roundsPlayed += x.rounds_played;
          // Per-player stats: aStats belongs to the lower-id player (agg.a), bStats to the higher.
          const aRow = x.player_id === agg.a ? x : y;
          const bRow = aRow === x ? y : x;
          for (const [statAgg, row] of [[agg.aStats, aRow], [agg.bStats, bRow]] as const) {
            statAgg.games += 1;
            statAgg.kills += row.kills;
            statAgg.assists += row.assists ?? 0;
            statAgg.deaths += row.deaths;
            statAgg.adrSum += row.adr;
            statAgg.roundsWon += row.rounds_won;
            statAgg.roundsPlayed += row.rounds_played;
          }
          if (playedMap) {
            const mapKey = playedMap.toLowerCase();
            const mapAgg = agg.mapTotals.get(mapKey) ?? emptyH2HMapAgg();
            mapAgg.games += 1;
            if (x.is_win) mapAgg.wins += 1;
            else mapAgg.losses += 1;
            mapAgg.roundsWon += x.rounds_won;
            mapAgg.roundsPlayed += x.rounds_played;
            mapAgg.aAdrSum += x.adr + y.adr;
            agg.mapTotals.set(mapKey, mapAgg);
          }
          agg.matches.push({
            matchId: m.matchId,
            seasonNumber: m.seasonNumber,
            isGauntlet: m.isGauntlet,
            weekNumber: m.weekNumber,
            matchNumber: m.matchNumber,
            map: playedMap,
            pickedBy: m.pickedBy,
            startingSide: m.startingSide,
            score: ourScore != null && theirScore != null ? { duo: ourScore, opponents: theirScore } : null,
            won: x.is_win,
            team: team.map(toRosterPlayer),
            opponents: opponents.map(toRosterPlayer),
          });
        }
      }
    }

    for (const x of shirts) {
      for (const y of skins) {
        const agg = getRival(x, y);
        agg.meetings += 1;
        const aRow = x.player_id === agg.a ? x : y;
        const bRow = aRow === x ? y : x;
        if (aRow.is_win) agg.aWins += 1;
        else agg.bWins += 1;

        for (const [statAgg, row] of [[agg.aStats, aRow], [agg.bStats, bRow]] as const) {
          statAgg.games += 1;
          statAgg.kills += row.kills;
          statAgg.assists += row.assists ?? 0;
          statAgg.deaths += row.deaths;
          statAgg.adrSum += row.adr;
          statAgg.roundsWon += row.rounds_won;
          statAgg.roundsPlayed += row.rounds_played;
        }

        if (playedMap) {
          const mapKey = playedMap.toLowerCase();
          const mapAgg = agg.mapTotals.get(mapKey) ?? emptyH2HMapAgg();
          mapAgg.games += 1;
          if (aRow.is_win) mapAgg.wins += 1;
          else mapAgg.losses += 1;
          mapAgg.roundsWon += aRow.rounds_won;
          mapAgg.roundsPlayed += aRow.rounds_played;
          mapAgg.aAdrSum += aRow.adr;
          mapAgg.bAdrSum += bRow.adr;
          agg.mapTotals.set(mapKey, mapAgg);
        }

        const aScore = parsedScore ? (aRow.faction === 'SHIRTS' ? parsedScore.shirts : parsedScore.skins) : null;
        const bScore = parsedScore ? (bRow.faction === 'SHIRTS' ? parsedScore.shirts : parsedScore.skins) : null;
        // 2v2 Wingman, so each side's full roster is just the shirts/skins group aRow/bRow belongs to.
        agg.matches.push({
          matchId: m.matchId,
          seasonNumber: m.seasonNumber,
          isGauntlet: m.isGauntlet,
          weekNumber: m.weekNumber,
          matchNumber: m.matchNumber,
          map: playedMap,
          pickedBy: m.pickedBy,
          startingSide: m.startingSide,
          score: aScore != null && bScore != null ? { a: aScore, b: bScore } : null,
          aWon: aRow.is_win,
          aTeam: (aRow.faction === 'SHIRTS' ? shirts : skins).map(toRosterPlayer),
          bTeam: (bRow.faction === 'SHIRTS' ? shirts : skins).map(toRosterPlayer),
        });
      }
    }
  }

  const duos: DuoStats[] = [...duoAgg.values()].map((d) => ({
    playerA: d.a,
    playerB: d.b,
    gamesPlayed: d.games,
    wins: d.wins,
    losses: d.losses,
    combinedAdr: d.games > 0 ? d.adrSum / d.games : 0,
    combinedKills: d.kills,
    combinedAssists: d.assists,
    combinedDeaths: d.deaths,
    roundsWon: d.roundsWon,
    roundsPlayed: d.roundsPlayed,
    aStats: finalizeH2HPlayerStats(d.aStats),
    bStats: finalizeH2HPlayerStats(d.bStats),
    bestMap: bestH2HMapFor(d.mapTotals),
    mapBreakdown: finalizeMapBreakdown(d.mapTotals),
    matches: [...d.matches].sort(compareMatchRefDesc), // most recent first
  }));

  const rivals: H2HStats[] = [...rivalAgg.values()].map((r) => {
    const sortedMatches = [...r.matches].sort(compareMatchRefDesc); // most recent first
    return {
      playerA: r.a,
      playerB: r.b,
      meetings: r.meetings,
      aWins: r.aWins,
      bWins: r.bWins,
      lastMap: sortedMatches[0]?.map ?? null,
      aStats: finalizeH2HPlayerStats(r.aStats),
      bStats: finalizeH2HPlayerStats(r.bStats),
      mapBreakdown: finalizeMapBreakdown(r.mapTotals),
      matches: sortedMatches,
    };
  });

  const playerList = [...playerIds]
    .map((id) => ({
      id,
      name: players.get(id)?.name ?? `#${id}`,
      steam_avatar_url: players.get(id)?.steam_avatar_url ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { duos, rivals, players: playerList };
}

/** Look up a pair's duo record regardless of which side is `playerA`/`playerB` in the stored row —
 *  the single lookup every H2H-consuming view needs, reusing the same order-agnostic identity
 *  `computeH2H` itself groups pairs by. */
export function findDuo(duos: DuoStats[], a: number, b: number): DuoStats | undefined {
  const key = h2hPairKey(a, b);
  return duos.find((d) => h2hPairKey(d.playerA, d.playerB) === key);
}

/** The rival-record counterpart of `findDuo`. */
export function findRival(rivals: H2HStats[], a: number, b: number): H2HStats | undefined {
  const key = h2hPairKey(a, b);
  return rivals.find((r) => h2hPairKey(r.playerA, r.playerB) === key);
}

/** Returns a copy of `rival` with A/B flipped so that `desiredA` is always playerA — lets a
 *  caller pin a consistent side (e.g. always the shirts player) regardless of which player
 *  `computeH2H` happened to assign as A by id ordering. */
export function normalizeRival(rival: H2HStats, desiredA: number): H2HStats {
  if (rival.playerA === desiredA) return rival;
  return {
    playerA: rival.playerB,
    playerB: rival.playerA,
    meetings: rival.meetings,
    aWins: rival.bWins,
    bWins: rival.aWins,
    lastMap: rival.lastMap,
    aStats: rival.bStats,
    bStats: rival.aStats,
    mapBreakdown: rival.mapBreakdown.map((s) => ({
      ...s,
      wins: s.losses,
      losses: s.wins,
      roundsWon: s.roundsPlayed - s.roundsWon,
      aAdr: s.bAdr,
      bAdr: s.aAdr,
    })),
    matches: rival.matches.map((m) => ({
      ...m,
      aWon: m.aWon == null ? null : !m.aWon,
      aTeam: m.bTeam,
      bTeam: m.aTeam,
      score: m.score ? { a: m.score.b, b: m.score.a } : null,
    })),
  };
}

// Minimal shape for `mapMatchRowsToH2HInput` — mirrors `MapMatchRow`/`MapPlayerStat`
// from queries.ts without importing them, so this file stays supabase-free.
interface _H2HSourceStat {
  player_id: number;
  faction: 'SHIRTS' | 'SKINS';
  kills: number;
  assists: number;
  deaths: number;
  adr: number;
  rounds_played: number;
  rounds_won: number;
  is_win: boolean;
}
interface _H2HSourceMatch {
  match_id: number;
  match_number: number;
  week_number: number;
  season_number: number | null;
  is_gauntlet: boolean;
  final_score: string | null;
  picked_map: string | null;
  shirts_pick: string | null;
  skins_starting_side: 'CT' | 'T' | null;
  shirts_stats: _H2HSourceStat[];
  skins_stats: _H2HSourceStat[];
}

/**
 * Who picked the played map — see "Who picked" in docs/glossary.md. `shirts_pick`
 * set means shirts picked; otherwise `picked_map` set means skins picked; neither
 * set (e.g. gauntlet matches, which have no veto data) means unknown.
 */
export function resolveH2HPickedBy(shirtsPick: string | null, pickedMap: string | null): 'SHIRTS' | 'SKINS' | null {
  if (shirtsPick != null) return 'SHIRTS';
  if (pickedMap != null) return 'SKINS';
  return null;
}

/**
 * Adapts already-fetched match rows (`MapMatchRow[]` in queries.ts — used by the
 * Statistics and Map pages, which load full match history client-side for their
 * other tabs) into `computeH2H`'s input shape. Callers should pass already
 * played+filtered matches (see `isPlayedScore`, and each page's own season filter).
 */
export function mapMatchRowsToH2HInput(matches: _H2HSourceMatch[]): H2HMatchInput[] {
  return matches.map((m) => ({
    matchId: m.match_id,
    weekNumber: m.week_number,
    matchNumber: m.match_number,
    seasonNumber: m.season_number,
    isGauntlet: m.is_gauntlet,
    // Some seasons recorded the played map under `shirts_pick` rather than
    // `picked_map` — same fallback used throughout the codebase (see
    // `getMatchById`, `getCareerMatchHistory`, `getH2HData`).
    map: m.shirts_pick ?? m.picked_map,
    pickedBy: resolveH2HPickedBy(m.shirts_pick, m.picked_map),
    startingSide: m.skins_starting_side,
    finalScore: m.final_score,
    roster: [...m.shirts_stats, ...m.skins_stats],
  }));
}

// Minimal shape shared by `scheduleToH2HInput`/`gauntletRoundsToH2HInput`/`matchToH2HInput` —
// mirrors `MatchWithRoster`/`GauntletMatch`/`Match` (queries/schedule.ts, queries/gauntlet.ts,
// the match page) without importing them, so this file stays supabase-free.
interface _SeasonSourceMatch {
  id: number;
  match_number: number;
  final_score: string | null;
  picked_map: string | null;
  shirts_pick: string | null;
  skins_starting_side: 'CT' | 'T' | null;
  shirts_stats: _H2HSourceStat[];
  skins_stats: _H2HSourceStat[];
}

/** Adapts one already-resolved match (with its own roster) into `computeH2H`'s input shape.
 *  Shared by `scheduleToH2HInput`/`gauntletRoundsToH2HInput` (a season's own H2H tab, one match
 *  at a time across a week/round) and a match page's own H2H tab (a single match). */
export function matchToH2HInput(
  m: _SeasonSourceMatch,
  weekOrRoundNumber: number,
  seasonNumber: number | null,
  isGauntlet: boolean,
): H2HMatchInput {
  return {
    matchId: m.id,
    weekNumber: weekOrRoundNumber,
    matchNumber: m.match_number,
    seasonNumber,
    isGauntlet,
    map: m.shirts_pick ?? m.picked_map,
    pickedBy: resolveH2HPickedBy(m.shirts_pick, m.picked_map),
    startingSide: m.skins_starting_side,
    finalScore: m.final_score,
    roster: [...m.shirts_stats, ...m.skins_stats],
  };
}

/**
 * Adapts a single regular season's already-fetched schedule (`WeekWithMatches[]` in
 * queries/schedule.ts — used by the season page for its own Schedule tab) into `computeH2H`'s
 * input shape, for the season page's own H2H tab. Every match here belongs to the same season, so
 * `seasonNumber` is passed once rather than resolved per match the way `mapMatchRowsToH2HInput`
 * does for callers spanning several seasons. Unlike `mapMatchRowsToH2HInput`, filters to played
 * matches internally (via `isPlayedScore`) rather than requiring the caller to pre-filter — the
 * nested week/match shape makes external filtering awkward, and a season page never wants
 * unplayed matches in its own H2H tab.
 */
export function scheduleToH2HInput(
  weeks: { week_number: number; matches: _SeasonSourceMatch[] }[],
  seasonNumber: number | null,
): H2HMatchInput[] {
  return weeks.flatMap((w) =>
    w.matches
      .filter((m) => isPlayedScore(m.final_score))
      .map((m) => matchToH2HInput(m, w.week_number, seasonNumber, false)),
  );
}

/** The gauntlet-rounds counterpart of `scheduleToH2HInput` — adapts `GauntletRound[]`
 *  (queries/gauntlet.ts) for a gauntlet season's own H2H tab. */
export function gauntletRoundsToH2HInput(
  rounds: { round_number: number; matches: _SeasonSourceMatch[] }[],
  seasonNumber: number | null,
): H2HMatchInput[] {
  return rounds.flatMap((r) =>
    r.matches
      .filter((m) => isPlayedScore(m.final_score))
      .map((m) => matchToH2HInput(m, r.round_number, seasonNumber, true)),
  );
}
