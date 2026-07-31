import { supabase } from '../supabase';
import type { Season } from '../types';
import { extractSeasonNumber } from '../util';
import { getPlayersById } from './player';

export interface SeasonRosterEntry {
  player_id: number;
  player_name: string;
  steam_avatar_url: string | null;
  joined_at: string;
}

export async function getSeasons(): Promise<Season[]> {
  const { data, error } = await supabase
    .from('seasons')
    .select('*')
    .order('id');
  if (error) throw error;
  return (data ?? []) as Season[];
}

export async function getSeason(id: number): Promise<Season | null> {
  const { data, error } = await supabase
    .from('seasons')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Season | null;
}

/** Find the gauntlet season paired to a regular season by season number in name. */
export async function getLinkedGauntlet(regularSeasonName: string): Promise<Season | null> {
  const num = extractSeasonNumber(regularSeasonName);
  if (num == null) return null;
  const { data, error } = await supabase.from('seasons').select('*').eq('is_gauntlet', true);
  if (error) throw error;
  return ((data ?? []) as Season[]).find((s) => extractSeasonNumber(s.name) === num) ?? null;
}

/** Find the regular season paired to a gauntlet season by season number in name. */
export async function getLinkedRegularSeason(gauntletName: string): Promise<Season | null> {
  const num = extractSeasonNumber(gauntletName);
  if (num == null) return null;
  const { data, error } = await supabase.from('seasons').select('*').eq('is_gauntlet', false);
  if (error) throw error;
  return ((data ?? []) as Season[]).find((s) => extractSeasonNumber(s.name) === num) ?? null;
}

/** A season's explicit roster (`season_players`) — the pre-match-history source of who's on a
 * season before any matches exist to derive it from. Sorted by player name. */
export async function getSeasonRoster(seasonId: number): Promise<SeasonRosterEntry[]> {
  const [{ data, error }, playersById] = await Promise.all([
    supabase.from('season_players').select('player_id, joined_at').eq('season_id', seasonId),
    getPlayersById(),
  ]);
  if (error) throw error;

  const rows = (data ?? []) as { player_id: number; joined_at: string }[];
  const entries: SeasonRosterEntry[] = [];
  for (const r of rows) {
    const player = playersById.get(r.player_id);
    if (!player) continue;
    entries.push({
      player_id: r.player_id,
      player_name: player.name,
      steam_avatar_url: player.steam_avatar_url,
      joined_at: r.joined_at,
    });
  }
  return entries.sort((a, b) => a.player_name.localeCompare(b.player_name));
}
