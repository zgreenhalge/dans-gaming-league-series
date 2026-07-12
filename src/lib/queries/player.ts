import { supabase } from '../supabase';
import type { Player, Season, Week, Match, PlayerMatchStat } from '../types';
import { extractSeasonNumber, compareMatchRefDesc } from '../util';
import type { RosterStat } from './schedule';
import { getAllSeasonMedalists, type TrophyEntry } from './trophies';
import { fetchAllPages } from './_shared';


export interface PlayerHistoryRow extends PlayerMatchStat {
  match_number: number;
  week_number: number;
  season_id: number;
  season_number: number | null;
  season_name: string;
  is_gauntlet: boolean;
  map: string | null;
  final_score: string | null;
  scheduled_at: string | null;
  shirts: { player_id: number; player_name: string }[];
  skins: { player_id: number; player_name: string }[];
  shirts_stats: RosterStat[];
  skins_stats: RosterStat[];
  picked_map: string | null;
  shirts_pick: string | null;
  skins_starting_side: 'CT' | 'T' | null;
  shirts_ban: string | null;
  shirts_ban2: string | null;
  skins_ban1: string | null;
  skins_ban2: string | null;
}

export interface PlayerDetail {
  player: Player;
  history: PlayerHistoryRow[];
  trophies: TrophyEntry[];
}

export async function getPlayersById(): Promise<Map<number, Player>> {
  const { data, error } = await supabase.from('players').select('*');
  if (error) throw error;
  const map = new Map<number, Player>();
  for (const p of (data ?? []) as Player[]) map.set(p.id, p);
  return map;
}

export async function getPlayer(playerId: number): Promise<PlayerDetail | null> {
  const { data: player, error: pErr } = await supabase
    .from('players')
    .select('*')
    .eq('id', playerId)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!player) return null;

  const [statRows, medalists] = await Promise.all([
    fetchAllPages<PlayerMatchStat>((from, to) =>
      supabase.from('player_match_stats').select('*').eq('player_id', playerId).range(from, to),
    ),
    getAllSeasonMedalists(),
  ]);
  const trophies = medalists.get(playerId) ?? [];
  if (statRows.length === 0) {
    return { player: player as Player, history: [], trophies };
  }

  const matchIds = Array.from(new Set(statRows.map((s) => s.match_id)));
  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select('*')
    .in('id', matchIds);
  if (mErr) throw mErr;
  const matchById = new Map<number, Match>();
  for (const m of (matches ?? []) as Match[]) matchById.set(m.id, m);

  const weekIds = Array.from(
    new Set((matches ?? []).map((m) => (m as Match).week_id)),
  );
  const { data: weeks, error: wErr } = await supabase
    .from('weeks')
    .select('*')
    .in('id', weekIds);
  if (wErr) throw wErr;
  const weekById = new Map<number, Week>();
  for (const w of (weeks ?? []) as Week[]) weekById.set(w.id, w);

  const seasonIds = Array.from(
    new Set((weeks ?? []).map((w) => (w as Week).season_id)),
  );
  const { data: seasons, error: seErr } = await supabase
    .from('seasons')
    .select('*')
    .in('id', seasonIds);
  if (seErr) throw seErr;
  const seasonById = new Map<number, Season>();
  for (const s of (seasons ?? []) as Season[]) seasonById.set(s.id, s);

  // Fetch all stat rows for the involved matches so we can show full rosters.
  const [{ data: allStats, error: aErr }, players] = await Promise.all([
    supabase
      .from('player_match_stats')
      .select('*')
      .in('match_id', matchIds),
    getPlayersById(),
  ]);
  if (aErr) throw aErr;

  type StatRow = {
    match_id: number;
    player_id: number;
    faction: 'SHIRTS' | 'SKINS';
    kills: number;
    assists: number;
    deaths: number;
    adr: number;
    is_win: boolean;
  };

  const rosterByMatch = new Map<
    number,
    { shirts: { player_id: number; player_name: string }[]; skins: { player_id: number; player_name: string }[]; shirts_stats?: StatRow[]; skins_stats?: StatRow[] }
  >();
  for (const st of (allStats ?? []) as StatRow[]) {
    const entry = rosterByMatch.get(st.match_id) ?? { shirts: [], skins: [] };
    const p = players.get(st.player_id);
    const slot = {
      player_id: st.player_id,
      player_name: p?.name ?? `#${st.player_id}`,
    };

    const statObj = {
      match_id: st.match_id,
      player_id: st.player_id,
      player_name: p?.name ?? `#${st.player_id}`,
      faction: st.faction,
      kills: st.kills,
      assists: st.assists ?? 0,
      deaths: st.deaths,
      adr: st.adr ?? 0,
      is_win: !!st.is_win,
    };

    if (st.faction === 'SHIRTS') {
      entry.shirts.push(slot);
      entry.shirts_stats = (entry.shirts_stats ?? []).concat(statObj);
    } else {
      entry.skins.push(slot);
      entry.skins_stats = (entry.skins_stats ?? []).concat(statObj);
    }
    rosterByMatch.set(st.match_id, entry);
  }

  const history = statRows
    .map((s) => {
      const m = matchById.get(s.match_id);
      if (!m) return null;
      const w = weekById.get(m.week_id);
      if (!w) return null;
      const se = seasonById.get(w.season_id);
      if (!se) return null;
      const roster = rosterByMatch.get(m.id) ?? { shirts: [], skins: [] };
      return {
        ...s,
        match_number: m.match_number,
        week_number: w.week_number,
        season_id: se.id,
        season_number: extractSeasonNumber(se.name),
        season_name: se.name,
        is_gauntlet: se.is_gauntlet,
        map: m.shirts_pick ?? m.picked_map,
        final_score: m.final_score,
        scheduled_at: m.scheduled_at,
        shirts: roster.shirts,
        skins: roster.skins,
        shirts_stats: roster.shirts_stats ?? [],
        skins_stats: roster.skins_stats ?? [],
        picked_map: m.picked_map,
        shirts_pick: m.shirts_pick,
        skins_starting_side: m.skins_starting_side,
        shirts_ban: m.shirts_ban,
        shirts_ban2: m.shirts_ban2,
        skins_ban1: m.skins_ban1,
        skins_ban2: m.skins_ban2,
      };
    })
    .filter((r): r is PlayerHistoryRow => r !== null)
    .sort((a, b) =>
      compareMatchRefDesc(
        { seasonNumber: extractSeasonNumber(a.season_name), isGauntlet: a.is_gauntlet, weekNumber: a.week_number, matchNumber: a.match_number },
        { seasonNumber: extractSeasonNumber(b.season_name), isGauntlet: b.is_gauntlet, weekNumber: b.week_number, matchNumber: b.match_number },
      ),
    );

  return { player: player as Player, history, trophies };
}
