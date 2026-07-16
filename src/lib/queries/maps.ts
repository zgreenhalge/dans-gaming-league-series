import { gunzipMaybe } from '../gzip';
import { supabase } from '../supabase';
import { getR2Object, heatmapKey } from '../r2';
import type { HeatmapArtifact, HeatmapKind } from '../replay/heatmap';
import { isPlayedScore, parseScore, extractSeasonNumber, canonicalSort, compareMatchRefDesc } from '../util';
import { classifyMatchVeto } from '../mapSideStats';
import { mapSlug } from '../maps';
import { workshopIdFromUrl } from '../replay/radar';
import type { MapIndexEntry, LeaderboardRowWithId, Faction, PlayerMatchStat } from '../types';
import { getPlayersById } from './player';
import { fetchAllPages } from './_shared';


export interface MapPlayerStat {
  player_id: number;
  player_name: string;
  faction: Faction;
  kills: number;
  assists: number;
  deaths: number;
  adr: number;
  damage: number;
  rounds_played: number;
  rounds_won: number;
  is_win: boolean;
}

export interface MapMatchRow {
  match_id: number;
  match_number: number;
  week_number: number;
  season_id: number;
  season_number: number | null;
  season_name: string;
  is_gauntlet: boolean;
  is_playoff_game: boolean;
  final_score: string | null;
  shirts_stats: MapPlayerStat[];
  skins_stats: MapPlayerStat[];
  picked_map: string | null;
  shirts_pick: string | null;
  skins_starting_side: 'CT' | 'T' | null;
  shirts_ban: string | null;
  shirts_ban2: string | null;
  skins_ban1: string | null;
  skins_ban2: string | null;
  /** This match's season's regular-season map pool. `null` for gauntlet seasons (no no-pick concept there). */
  map_pool: string[] | null;
}

export interface MapDetail {
  name: string;
  slug: string;
  pickCount: number;
  banCount: number;
  noPickCount: number;
  seasons: { id: number; name: string; is_gauntlet: boolean }[];
  matches: MapMatchRow[];
  playerStats: LeaderboardRowWithId[];
}

/**
 * Returns all played matches with pick/ban data and per-faction win flags.
 * Used by the statistics page to compute league-wide map pick/ban and side stats.
 */
export async function getAllMatchesWithPickBan(): Promise<MapMatchRow[]> {
  const { matches, weeks, seasons } = await fetchMapRawData();

  const weekById = new Map<number, RawWeek>();
  for (const w of weeks) weekById.set(w.id, w);
  const seasonById = new Map<number, RawSeason>();
  for (const s of seasons) seasonById.set(s.id, s);

  const playedMatches = matches.filter(
    (m) => isPlayedScore(m.final_score) && (m.shirts_pick != null || m.picked_map != null),
  );
  if (playedMatches.length === 0) return [];

  const matchIds = playedMatches.map((m) => m.id);
  const [{ data: statsData, error: sErr }, players] = await Promise.all([
    supabase.from('player_match_stats').select('*').in('match_id', matchIds),
    getPlayersById(),
  ]);
  if (sErr) throw sErr;
  const statRows = (statsData ?? []) as PlayerMatchStat[];

  const rosterByMatch = new Map<number, { shirts: MapPlayerStat[]; skins: MapPlayerStat[] }>();
  for (const s of statRows) {
    const entry = rosterByMatch.get(s.match_id) ?? { shirts: [], skins: [] };
    const player = players.get(s.player_id);
    const stat: MapPlayerStat = {
      player_id: s.player_id,
      player_name: player?.name ?? `#${s.player_id}`,
      faction: s.faction,
      kills: s.kills,
      assists: s.assists ?? 0,
      deaths: s.deaths,
      adr: s.adr ?? 0,
      damage: s.damage ?? 0,
      rounds_played: s.rounds_played ?? 0,
      rounds_won: s.rounds_won ?? 0,
      is_win: !!s.is_win,
    };
    if (s.faction === 'SHIRTS') entry.shirts.push(stat);
    else entry.skins.push(stat);
    rosterByMatch.set(s.match_id, entry);
  }

  return playedMatches
    .map((m) => {
      const week = weekById.get(m.week_id);
      if (!week) return null;
      const season = seasonById.get(week.season_id);
      if (!season) return null;
      const roster = rosterByMatch.get(m.id) ?? { shirts: [], skins: [] };
      return {
        match_id: m.id,
        match_number: m.match_number,
        week_number: week.week_number,
        season_id: season.id,
        season_number: extractSeasonNumber(season.name),
        season_name: season.name,
        is_gauntlet: season.is_gauntlet,
        is_playoff_game: m.is_playoff_game,
        final_score: m.final_score,
        shirts_stats: roster.shirts,
        skins_stats: roster.skins,
        picked_map: m.picked_map,
        shirts_pick: m.shirts_pick,
        skins_starting_side: m.skins_starting_side,
        shirts_ban: m.shirts_ban,
        shirts_ban2: m.shirts_ban2,
        skins_ban1: m.skins_ban1,
        skins_ban2: m.skins_ban2,
        map_pool: season.is_gauntlet ? null : season.map_pool,
      };
    })
    .filter((r): r is MapMatchRow => r !== null);
}

type RawMatch = {
  id: number;
  week_id: number;
  match_number: number;
  final_score: string | null;
  shirts_pick: string | null;
  picked_map: string | null;
  shirts_ban: string | null;
  shirts_ban2: string | null;
  skins_ban1: string | null;
  skins_ban2: string | null;
  is_playoff_game: boolean;
  skins_starting_side: 'CT' | 'T' | null;
};

type RawWeek = { id: number; season_id: number; week_number: number };
type RawSeason = { id: number; name: string; is_gauntlet: boolean; map_pool: string[] | null };

async function fetchMapRawData(): Promise<{
  matches: RawMatch[];
  weeks: RawWeek[];
  seasons: RawSeason[];
}> {
  const [{ data: matches, error: mErr }, { data: weeks, error: wErr }, { data: seasons, error: sErr }] =
    await Promise.all([
      supabase.from('matches').select('id, week_id, match_number, final_score, shirts_pick, picked_map, shirts_ban, shirts_ban2, skins_ban1, skins_ban2, is_playoff_game, skins_starting_side'),
      supabase.from('weeks').select('id, season_id, week_number'),
      supabase.from('seasons').select('id, name, is_gauntlet, map_pool'),
    ]);
  if (mErr) throw mErr;
  if (wErr) throw wErr;
  if (sErr) throw sErr;
  return {
    matches: (matches ?? []) as RawMatch[],
    weeks: (weeks ?? []) as RawWeek[],
    seasons: (seasons ?? []) as RawSeason[],
  };
}

function buildCanonicalNames(matches: RawMatch[], seasons: RawSeason[]): Map<string, string> {
  const canonical = new Map<string, string>();
  for (const m of matches) {
    for (const v of [m.shirts_pick, m.picked_map, m.shirts_ban, m.shirts_ban2, m.skins_ban1, m.skins_ban2]) {
      if (!v) continue;
      const t = v.trim();
      if (t && !canonical.has(t.toLowerCase())) canonical.set(t.toLowerCase(), t);
    }
  }
  for (const s of seasons) {
    for (const m of s.map_pool ?? []) {
      const t = m.trim();
      if (t && !canonical.has(t.toLowerCase())) canonical.set(t.toLowerCase(), t);
    }
  }
  return canonical;
}

export async function getMapIndex(): Promise<MapIndexEntry[]> {
  const { matches, weeks, seasons } = await fetchMapRawData();
  const canonicalName = buildCanonicalNames(matches, seasons);

  const weekToSeason = new Map<number, RawSeason>();
  for (const w of weeks) {
    const s = seasons.find((s) => s.id === w.season_id);
    if (s) weekToSeason.set(w.id, s);
  }

  const seasonById = new Map<number, RawSeason>();
  for (const s of seasons) seasonById.set(s.id, s);

  // per-map, per-season counts
  const picksBySeason = new Map<string, Map<number, number>>();
  const bansBySeason = new Map<string, Map<number, number>>();
  const noPicksBySeason = new Map<string, Map<number, number>>();
  const pickCount = new Map<string, number>();
  const banCount = new Map<string, number>();
  const noPickCount = new Map<string, number>();
  const matchMapKey = new Map<number, string>();

  function bump(bySeasonMap: Map<string, Map<number, number>>, totalMap: Map<string, number>, key: string, seasonId: number | undefined) {
    totalMap.set(key, (totalMap.get(key) ?? 0) + 1);
    if (seasonId == null) return;
    const bySid = bySeasonMap.get(key) ?? new Map<number, number>();
    bySid.set(seasonId, (bySid.get(seasonId) ?? 0) + 1);
    bySeasonMap.set(key, bySid);
  }

  for (const m of matches) {
    const season = weekToSeason.get(m.week_id);
    const { picked, banned, noPicked } = classifyMatchVeto({
      final_score: m.final_score,
      picked_map: m.picked_map,
      shirts_pick: m.shirts_pick,
      shirts_ban: m.shirts_ban,
      shirts_ban2: m.shirts_ban2,
      skins_ban1: m.skins_ban1,
      skins_ban2: m.skins_ban2,
      is_playoff_game: m.is_playoff_game,
      map_pool: season && !season.is_gauntlet ? season.map_pool : null,
    });

    for (const name of picked) {
      const key = name.toLowerCase();
      matchMapKey.set(m.id, key);
      bump(picksBySeason, pickCount, key, season?.id);
    }
    for (const name of banned) bump(bansBySeason, banCount, name.toLowerCase(), season?.id);
    for (const name of noPicked) bump(noPicksBySeason, noPickCount, name.toLowerCase(), season?.id);
  }

  // totalKills and pickAndWon: fetch player_match_stats for played matches
  const playedMatchIds = Array.from(matchMapKey.keys());
  // match_id → season_id (for played matches)
  const matchSeasonId = new Map<number, number>();
  for (const m of matches) {
    if (!matchMapKey.has(m.id)) continue;
    const season = weekToSeason.get(m.week_id);
    if (season) matchSeasonId.set(m.id, season.id);
  }

  const totalKillsBySeason = new Map<string, Map<number, number>>();
  const totalAssistsBySeason = new Map<string, Map<number, number>>();
  const totalRoundsBySeason = new Map<string, Map<number, number>>();
  const pickAndWonBySeason = new Map<string, Map<number, number>>();

  const matchRounds = new Map<number, number>();
  for (const m of matches) {
    if (!matchMapKey.has(m.id)) continue;
    const parsed = parseScore(m.final_score);
    if (parsed) matchRounds.set(m.id, parsed.shirts + parsed.skins);
  }

  if (playedMatchIds.length > 0) {
    const { data: statsData } = await supabase
      .from('player_match_stats')
      .select('match_id, kills, assists, faction, is_win')
      .in('match_id', playedMatchIds);

    // First pass: per-match totals
    const matchKills = new Map<number, number>();
    const matchAssists = new Map<number, number>();
    const shirtsWon = new Map<number, boolean>();
    for (const s of (statsData ?? []) as { match_id: number; kills: number; assists: number; faction: string; is_win: boolean }[]) {
      matchKills.set(s.match_id, (matchKills.get(s.match_id) ?? 0) + s.kills);
      matchAssists.set(s.match_id, (matchAssists.get(s.match_id) ?? 0) + (s.assists ?? 0));
      if (s.faction === 'SHIRTS') {
        if (s.is_win) shirtsWon.set(s.match_id, true);
        else if (!shirtsWon.has(s.match_id)) shirtsWon.set(s.match_id, false);
      }
    }

    // Second pass: aggregate per map key + season
    for (const [matchId, mapKey] of matchMapKey) {
      const sid = matchSeasonId.get(matchId);
      if (sid == null) continue;
      const kills = matchKills.get(matchId) ?? 0;
      const kBySid = totalKillsBySeason.get(mapKey) ?? new Map<number, number>();
      kBySid.set(sid, (kBySid.get(sid) ?? 0) + kills);
      totalKillsBySeason.set(mapKey, kBySid);
      const assists = matchAssists.get(matchId) ?? 0;
      const aBySid = totalAssistsBySeason.get(mapKey) ?? new Map<number, number>();
      aBySid.set(sid, (aBySid.get(sid) ?? 0) + assists);
      totalAssistsBySeason.set(mapKey, aBySid);
      const rounds = matchRounds.get(matchId) ?? 0;
      const rBySid = totalRoundsBySeason.get(mapKey) ?? new Map<number, number>();
      rBySid.set(sid, (rBySid.get(sid) ?? 0) + rounds);
      totalRoundsBySeason.set(mapKey, rBySid);
      if (shirtsWon.get(matchId)) {
        const wBySid = pickAndWonBySeason.get(mapKey) ?? new Map<number, number>();
        wBySid.set(sid, (wBySid.get(sid) ?? 0) + 1);
        pickAndWonBySeason.set(mapKey, wBySid);
      }
    }
  }

  const mapSeasons = new Map<string, { id: number; name: string; is_gauntlet: boolean }[]>();
  for (const s of seasons) {
    for (const m of s.map_pool ?? []) {
      const key = m.trim().toLowerCase();
      const slist = mapSeasons.get(key) ?? [];
      slist.push({ id: s.id, name: s.name, is_gauntlet: s.is_gauntlet });
      mapSeasons.set(key, slist);
    }
  }

  return Array.from(canonicalName.keys()).map((key) => {
    const name = canonicalName.get(key)!;

    const allSids = new Set<number>([
      ...Array.from(picksBySeason.get(key)?.keys() ?? []),
      ...Array.from(bansBySeason.get(key)?.keys() ?? []),
      ...Array.from(noPicksBySeason.get(key)?.keys() ?? []),
      ...Array.from(totalKillsBySeason.get(key)?.keys() ?? []),
      ...Array.from(totalAssistsBySeason.get(key)?.keys() ?? []),
      ...Array.from(totalRoundsBySeason.get(key)?.keys() ?? []),
    ]);
    const statsBySeason = Array.from(allSids).map((sid) => ({
      seasonId: sid,
      isGauntlet: seasonById.get(sid)?.is_gauntlet ?? false,
      pickCount: picksBySeason.get(key)?.get(sid) ?? 0,
      banCount: bansBySeason.get(key)?.get(sid) ?? 0,
      noPickCount: noPicksBySeason.get(key)?.get(sid) ?? 0,
      totalKills: totalKillsBySeason.get(key)?.get(sid) ?? 0,
      totalAssists: totalAssistsBySeason.get(key)?.get(sid) ?? 0,
      totalRounds: totalRoundsBySeason.get(key)?.get(sid) ?? 0,
      pickAndWon: pickAndWonBySeason.get(key)?.get(sid) ?? 0,
    })).sort((a, b) => a.seasonId - b.seasonId);

    return {
      name,
      slug: mapSlug(name),
      pickCount: pickCount.get(key) ?? 0,
      banCount: banCount.get(key) ?? 0,
      noPickCount: noPickCount.get(key) ?? 0,
      seasons: mapSeasons.get(key) ?? [],
      statsBySeason,
    };
  }).sort((a, b) => b.pickCount - a.pickCount);
}

export async function getMapDetail(slug: string): Promise<MapDetail | null> {
  const { matches, weeks, seasons } = await fetchMapRawData();
  const canonicalName = buildCanonicalNames(matches, seasons);

  const mapName = Array.from(canonicalName.values()).find((v) => mapSlug(v) === slug);
  if (!mapName) return null;
  const nameLower = mapName.toLowerCase();

  const weekById = new Map<number, RawWeek>();
  for (const w of weeks) weekById.set(w.id, w);
  const seasonById = new Map<number, RawSeason>();
  for (const s of seasons) seasonById.set(s.id, s);

  const playedMatches = matches.filter((m) => {
    const played = (m.shirts_pick ?? m.picked_map ?? '').trim().toLowerCase();
    return played === nameLower && isPlayedScore(m.final_score);
  });

  const weekToSeasonId = new Map<number, number>();
  for (const w of weeks) weekToSeasonId.set(w.id, w.season_id);

  let bans = 0;
  let noPickCount = 0;
  for (const m of matches) {
    const sid = weekToSeasonId.get(m.week_id);
    const season = sid != null ? seasonById.get(sid) : undefined;
    const { banned, noPicked } = classifyMatchVeto({
      final_score: m.final_score,
      picked_map: m.picked_map,
      shirts_pick: m.shirts_pick,
      shirts_ban: m.shirts_ban,
      shirts_ban2: m.shirts_ban2,
      skins_ban1: m.skins_ban1,
      skins_ban2: m.skins_ban2,
      is_playoff_game: m.is_playoff_game,
      map_pool: season && !season.is_gauntlet ? season.map_pool : null,
    });
    if (banned.some((b) => b.toLowerCase() === nameLower)) bans++;
    if (noPicked.some((n) => n.toLowerCase() === nameLower)) noPickCount++;
  }

  // Seasons where this map is in the pool OR had any veto activity
  const seasonIdsSeen = new Set<number>();
  for (const s of seasons) {
    if ((s.map_pool ?? []).some((m) => m.trim().toLowerCase() === nameLower)) {
      seasonIdsSeen.add(s.id);
    }
  }
  for (const m of matches) {
    const sid = weekToSeasonId.get(m.week_id);
    if (sid == null) continue;
    const vetoFields = [m.shirts_pick, m.picked_map, m.shirts_ban, m.shirts_ban2, m.skins_ban1, m.skins_ban2];
    if (vetoFields.some((v) => v && v.trim().toLowerCase() === nameLower)) {
      seasonIdsSeen.add(sid);
    }
  }

  const mapSeasons: { id: number; name: string; is_gauntlet: boolean }[] = [];
  for (const s of seasons) {
    if (seasonIdsSeen.has(s.id)) {
      mapSeasons.push({ id: s.id, name: s.name, is_gauntlet: s.is_gauntlet });
    }
  }

  if (playedMatches.length === 0) {
    return { name: mapName, slug, pickCount: 0, banCount: bans, noPickCount, seasons: mapSeasons, matches: [], playerStats: [] };
  }

  const matchIds = playedMatches.map((m) => m.id);
  const [{ data: statsData, error: sErr }, players] = await Promise.all([
    supabase.from('player_match_stats').select('*').in('match_id', matchIds),
    getPlayersById(),
  ]);
  if (sErr) throw sErr;
  const statRows = (statsData ?? []) as PlayerMatchStat[];

  const rosterByMatch = new Map<number, { shirts: MapPlayerStat[]; skins: MapPlayerStat[] }>();
  for (const s of statRows) {
    const entry = rosterByMatch.get(s.match_id) ?? { shirts: [], skins: [] };
    const player = players.get(s.player_id);
    const stat: MapPlayerStat = {
      player_id: s.player_id,
      player_name: player?.name ?? `#${s.player_id}`,
      faction: s.faction,
      kills: s.kills,
      assists: s.assists ?? 0,
      deaths: s.deaths,
      adr: s.adr ?? 0,
      damage: s.damage ?? 0,
      rounds_played: s.rounds_played ?? 0,
      rounds_won: s.rounds_won ?? 0,
      is_win: !!s.is_win,
    };
    if (s.faction === 'SHIRTS') entry.shirts.push(stat);
    else entry.skins.push(stat);
    rosterByMatch.set(s.match_id, entry);
  }

  const mapMatches: MapMatchRow[] = playedMatches
    .map((m) => {
      const week = weekById.get(m.week_id);
      if (!week) return null;
      const season = seasonById.get(week.season_id);
      if (!season) return null;
      const roster = rosterByMatch.get(m.id) ?? { shirts: [], skins: [] };
      return {
        match_id: m.id,
        match_number: m.match_number,
        week_number: week.week_number,
        season_id: season.id,
        season_number: extractSeasonNumber(season.name),
        season_name: season.name,
        is_gauntlet: season.is_gauntlet,
        is_playoff_game: m.is_playoff_game,
        final_score: m.final_score,
        shirts_stats: roster.shirts,
        skins_stats: roster.skins,
        picked_map: m.picked_map,
        shirts_pick: m.shirts_pick,
        skins_starting_side: m.skins_starting_side,
        shirts_ban: m.shirts_ban,
        shirts_ban2: m.shirts_ban2,
        skins_ban1: m.skins_ban1,
        skins_ban2: m.skins_ban2,
        map_pool: season.is_gauntlet ? null : season.map_pool,
      };
    })
    .filter((r): r is MapMatchRow => r !== null)
    .sort((a, b) =>
      compareMatchRefDesc(
        { seasonNumber: a.season_number, isGauntlet: a.is_gauntlet, weekNumber: a.week_number, matchNumber: a.match_number },
        { seasonNumber: b.season_number, isGauntlet: b.is_gauntlet, weekNumber: b.week_number, matchNumber: b.match_number },
      ),
    );

  type Agg = {
    player_id: number; player_name: string;
    matches_played: number; matches_won: number; matches_lost: number;
    total_kills: number; total_assists: number; total_deaths: number;
    total_damage: number; total_rounds_played: number; total_rounds_won: number;
    kills_in_wins: number; deaths_in_wins: number;
    kills_in_losses: number; deaths_in_losses: number;
  };
  const byPlayer = new Map<number, Agg>();
  for (const s of statRows) {
    const player = players.get(s.player_id);
    if (!player) continue;
    const agg = byPlayer.get(s.player_id) ?? {
      player_id: s.player_id, player_name: player.name,
      matches_played: 0, matches_won: 0, matches_lost: 0,
      total_kills: 0, total_assists: 0, total_deaths: 0,
      total_damage: 0, total_rounds_played: 0, total_rounds_won: 0,
      kills_in_wins: 0, deaths_in_wins: 0,
      kills_in_losses: 0, deaths_in_losses: 0,
    };
    agg.matches_played += 1;
    agg.matches_won += s.is_win ? 1 : 0;
    agg.matches_lost += s.is_win ? 0 : 1;
    agg.total_kills += s.kills;
    agg.total_assists += s.assists ?? 0;
    agg.total_deaths += s.deaths;
    agg.total_damage += s.damage ?? 0;
    agg.total_rounds_played += s.rounds_played ?? 0;
    agg.total_rounds_won += s.rounds_won ?? 0;
    agg.kills_in_wins += s.is_win ? s.kills : 0;
    agg.deaths_in_wins += s.is_win ? s.deaths : 0;
    agg.kills_in_losses += s.is_win ? 0 : s.kills;
    agg.deaths_in_losses += s.is_win ? 0 : s.deaths;
    byPlayer.set(s.player_id, agg);
  }

  const playerStats: LeaderboardRowWithId[] = Array.from(byPlayer.values()).map((a) => {
    const rp = a.total_rounds_played;
    const rw = a.total_rounds_won;
    return {
      season_id: 0,
      player_id: a.player_id,
      player_name: a.player_name,
      matches_played: a.matches_played,
      matches_won: a.matches_won,
      matches_lost: a.matches_lost,
      win_rate_percentage: a.matches_played > 0 ? (a.matches_won / a.matches_played) * 100 : 0,
      total_kills: a.total_kills,
      total_assists: a.total_assists,
      total_deaths: a.total_deaths,
      kd_ratio: a.total_deaths > 0 ? a.total_kills / a.total_deaths : a.total_kills,
      total_damage: a.total_damage,
      total_rounds_played: rp,
      total_rounds_won: rw,
      rwr_percentage: rp > 0 ? (rw / rp) * 100 : 0,
      overall_adr: rp > 0 ? a.total_damage / rp : 0,
      kills_in_wins: a.kills_in_wins,
      deaths_in_wins: a.deaths_in_wins,
      kills_in_losses: a.kills_in_losses,
      deaths_in_losses: a.deaths_in_losses,
    };
  }).sort(canonicalSort);

  return { name: mapName, slug, pickCount: playedMatches.length, banCount: bans, noPickCount, seasons: mapSeasons, matches: mapMatches, playerStats };
}

// ---------------------------------------------------------------------------
// Maps table lookup
// ---------------------------------------------------------------------------

export type MapRow = {
  id: number;
  name: string;
  slug: string;
  workshop_url: string | null;
  image_url: string | null;
};

export async function getMapLookup(): Promise<Record<string, { image_url: string | null; workshop_url: string | null }>> {
  const { data, error } = await supabase.from('maps').select('*');
  if (error) throw error;
  const lookup: Record<string, { image_url: string | null; workshop_url: string | null }> = {};
  for (const row of (data ?? []) as MapRow[]) {
    lookup[row.slug] = { image_url: row.image_url, workshop_url: row.workshop_url };
  }
  return lookup;
}

export interface WorkshopMapOption {
  name: string;
  workshopId: string;
}

/** Maps with a resolvable workshop id, for a workshop-map picker (e.g. the admin server console). */
export async function getMapsForWorkshopPicker(): Promise<WorkshopMapOption[]> {
  const { data, error } = await supabase.from('maps').select('name, workshop_url').order('name');
  if (error) throw error;
  const rows = (data ?? []) as { name: string; workshop_url: string | null }[];
  const options: WorkshopMapOption[] = [];
  for (const row of rows) {
    const workshopId = workshopIdFromUrl(row.workshop_url);
    if (workshopId) options.push({ name: row.name, workshopId });
  }
  return options;
}

/** A map's radar calibration triplet (Phase 3). `null` when the map isn't calibrated. */
export interface MapCalibration {
  mapId: number;
  posX: number;
  posY: number;
  scale: number;
  source: string | null;
}

/**
 * Read a map's radar calibration by slug. Returns `null` unless the full triplet AND
 * a radar image are present — callers (the replay player, the heatmap) fall back to
 * auto-fit when uncalibrated, so a partially-filled row is treated as uncalibrated.
 */
export async function getMapCalibration(slug: string): Promise<MapCalibration | null> {
  const { data } = await supabase
    .from('maps')
    .select('id, radar_pos_x, radar_pos_y, radar_scale, radar_image_url, radar_source')
    .eq('slug', slug)
    .maybeSingle();
  const r = data as {
    id: number;
    radar_pos_x: number | null;
    radar_pos_y: number | null;
    radar_scale: number | null;
    radar_image_url: string | null;
    radar_source: string | null;
  } | null;
  if (!r || r.radar_pos_x == null || r.radar_pos_y == null || r.radar_scale == null) return null;
  if (!r.radar_image_url) return null;
  return { mapId: r.id, posX: r.radar_pos_x, posY: r.radar_pos_y, scale: r.radar_scale, source: r.radar_source };
}

/** One heatmap point tagged with its source match (so the map page can season-filter). */
export interface MapHeatmapPoint {
  matchId: number;
  kind: HeatmapKind;
  x: number;
  y: number;
  side: 'CT' | 'T' | null;
  /** `null` for points from an artifact predating `HEATMAP_SCHEMA_VERSION` 2, or an unresolved actor. */
  playerId: number | null;
}

/**
 * Aggregate the compact `heatmap.json` artifacts (kill/death/grenade points) for a
 * set of matches into a flat, match-tagged list for the map Heatmap tab. Matches
 * without a replay yet are silently skipped (no artifact in R2). Reads are small
 * gzipped files; we fan out with Promise.all and let the page's revalidate cache it.
 */
export async function getMapHeatmap(matchIds: number[]): Promise<MapHeatmapPoint[]> {
  const perMatch = await Promise.all(
    matchIds.map(async (matchId): Promise<MapHeatmapPoint[]> => {
      const buf = await getR2Object(heatmapKey(matchId));
      if (!buf) return [];
      try {
        const json = gunzipMaybe(buf);
        const art = JSON.parse(json.toString('utf8')) as HeatmapArtifact;
        return art.points.map((p) => ({
          matchId,
          kind: p.kind,
          x: p.x,
          y: p.y,
          side: p.side,
          playerId: p.playerId ?? null,
        }));
      } catch {
        return [];
      }
    }),
  );
  return perMatch.flat();
}

/**
 * Match ids played on a given map (case-insensitive), for the match-page scouting
 * report's Map Intel heatmap. The played map is the pick (`shirts_pick`) falling back
 * to `picked_map` — the same rule `getMapDetail` uses. Only played matches qualify;
 * matches without a replay artifact are silently dropped later by `getMapHeatmap`.
 */
export async function getMatchIdsForMap(mapName: string): Promise<number[]> {
  const nameLower = mapName.trim().toLowerCase();
  if (!nameLower) return [];
  type Row = { id: number; shirts_pick: string | null; picked_map: string | null; final_score: string | null };
  const rows = await fetchAllPages<Row>((from, to) =>
    supabase.from('matches').select('id, shirts_pick, picked_map, final_score').range(from, to),
  );
  return rows
    .filter(
      (m) =>
        (m.shirts_pick ?? m.picked_map ?? '').trim().toLowerCase() === nameLower &&
        isPlayedScore(m.final_score),
    )
    .map((m) => m.id);
}

/** Ids of every played match — for the sitemap. */
export async function getAllPlayedMatchIds(): Promise<number[]> {
  type Row = { id: number; final_score: string | null };
  const rows = await fetchAllPages<Row>((from, to) =>
    supabase.from('matches').select('id, final_score').range(from, to),
  );
  return rows.filter((m) => isPlayedScore(m.final_score)).map((m) => m.id);
}
