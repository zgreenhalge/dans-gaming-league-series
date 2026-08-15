import { supabase } from '../supabase';
import type { Player, Season } from '../types';
import { extractSeasonNumber } from '../util';
import { getPlayersById } from './player';

export interface SeasonRosterEntry {
  player_id: number;
  player_name: string;
  steam_avatar_url: string | null;
  discord_id: string | null;
}

export async function getSeasons(): Promise<Season[]> {
  const { data, error } = await supabase
    .from('seasons')
    .select('*')
    .order('id');
  if (error) throw error;
  return (data ?? []) as Season[];
}

/** The current regular (non-gauntlet) `ACTIVE` season, or `null` if none is — a gauntlet can also be
 *  `ACTIVE` at the same time as its paired regular season briefly completes ahead of it (see
 *  architecture.md's season status lifecycle), so this always excludes gauntlets rather than
 *  picking whichever `ACTIVE` row sorts first. Ties (more than one `ACTIVE` regular season) resolve
 *  to the lowest id, same as the home page's own `active[0]` — not expected in practice. */
export async function getActiveRegularSeason(): Promise<Season | null> {
  const seasons = await getSeasons();
  return seasons.find((s) => !s.is_gauntlet && s.status === 'ACTIVE') ?? null;
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
 * season before any matches exist to derive it from. Sorted by player name. Pass an
 * already-fetched `playersById` (e.g. one a caller needs for its own purposes too, like a full
 * player picker) to skip this function's own redundant full-table read. */
export async function getSeasonRoster(seasonId: number, playersById?: Map<number, Player>): Promise<SeasonRosterEntry[]> {
  const [{ data, error }, resolvedPlayersById] = await Promise.all([
    supabase.from('season_players').select('player_id').eq('season_id', seasonId),
    playersById ?? getPlayersById(),
  ]);
  if (error) throw error;

  const rows = (data ?? []) as { player_id: number }[];
  const entries: SeasonRosterEntry[] = [];
  for (const r of rows) {
    const player = resolvedPlayersById.get(r.player_id);
    // A roster is a flat list — a row referencing a player_id missing from playersById is simply
    // omitted, unlike getSeasonScheduleDraft()'s player() helper, which throws on the equivalent
    // case. That's deliberate, not an inconsistency to reconcile: a list tolerates one fewer row
    // fine, but a schedule draft's match slot can't render at all without a real player in it.
    if (!player) continue;
    entries.push({
      player_id: r.player_id,
      player_name: player.name,
      steam_avatar_url: player.steam_avatar_url,
      discord_id: player.discord_id,
    });
  }
  return entries.sort((a, b) => a.player_name.localeCompare(b.player_name));
}

/** Everyone currently part of a season, unioning `season_players` with anyone who already has a
 *  scheduled or played match under it (`weeks` → `matches` → `player_match_stats`). `season_players`
 *  alone is the pre-schedule signup list; once a schedule exists, a season's real participants are
 *  whoever it actually rostered into matches — which for a season imported or scheduled without ever
 *  writing `season_players` rows (e.g. a historically-imported season) is the *only* place that
 *  membership is recorded. Used wherever "is this player currently part of the season" needs to be
 *  right regardless of which stage produced that membership — the `@Participants` Discord role sync
 *  (`discord-roles.ts`, `season-lifecycle.ts`), not `getSeasonRoster()`'s own callers (the roster
 *  editor, schedule generation), which specifically want the raw pre-schedule signup list. */
export async function getSeasonParticipants(seasonId: number, playersById?: Map<number, Player>): Promise<SeasonRosterEntry[]> {
  const [roster, resolvedPlayersById, { data: weekRows, error: weekErr }] = await Promise.all([
    getSeasonRoster(seasonId, playersById),
    playersById ?? getPlayersById(),
    supabase.from('weeks').select('id').eq('season_id', seasonId),
  ]);
  if (weekErr) throw weekErr;

  const byId = new Map(roster.map((r) => [r.player_id, r]));
  const weekIds = ((weekRows ?? []) as { id: number }[]).map((w) => w.id);
  if (weekIds.length > 0) {
    const { data: matchRows, error: matchErr } = await supabase.from('matches').select('id').in('week_id', weekIds);
    if (matchErr) throw matchErr;
    const matchIds = ((matchRows ?? []) as { id: number }[]).map((m) => m.id);
    if (matchIds.length > 0) {
      const { data: statRows, error: statErr } = await supabase.from('player_match_stats').select('player_id').in('match_id', matchIds);
      if (statErr) throw statErr;
      for (const { player_id } of (statRows ?? []) as { player_id: number }[]) {
        if (byId.has(player_id)) continue;
        const player = resolvedPlayersById.get(player_id);
        if (!player) continue;
        byId.set(player_id, {
          player_id,
          player_name: player.name,
          steam_avatar_url: player.steam_avatar_url,
          discord_id: player.discord_id,
        });
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.player_name.localeCompare(b.player_name));
}
