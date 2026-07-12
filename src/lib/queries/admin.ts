import { supabase } from '../supabase';
import type { Match, Player } from '../types';
import { matchLabel, extractSeasonNumber, compareMatchRefDesc, weekWindow } from '../util';


/** One row of the admin match-management console (#144) — a full match plus the context its editors
 *  (reschedule, clear/redo pick-ban, feature toggle) need. */
export interface AdminMatchRow {
  match: Match;
  label: string;
  seasonNumber: number | null;
  weekNumber: number | null;
  isGauntlet: boolean;
  mapPool: string[] | null;
  /** Week window (yyyy-mm-dd) for the schedule editor's out-of-window warning; null if undated. */
  weekStart: string | null;
  weekEnd: string | null;
}

/**
 * Every match with the context the admin match console (#144) needs to reschedule, clear/redo the
 * pick-ban, or toggle the feature flag: the full row plus season/week labels, map pool, gauntlet flag,
 * and week window. Sorted newest (season → week → match) first — same canonical order as the rest of
 * the site. Admin-only surface; the page gates access.
 */
export async function getAdminMatches(): Promise<AdminMatchRow[]> {
  const { data, error } = await supabase
    .from('matches')
    .select('*, weeks(week_number, seasons(name, is_gauntlet, map_pool, start_date))');
  if (error || !data) return [];

  type Row = Match & {
    weeks: {
      week_number: number | null;
      seasons: {
        name: string | null;
        is_gauntlet: boolean | null;
        map_pool: string[] | null;
        start_date: string | null;
      } | null;
    } | null;
  };
  // Supabase types embedded to-one relations as arrays but returns objects at runtime (same cast as
  // getOtherScheduledMatches above).
  const rows = data as unknown as Row[];

  const out = rows.map((r): AdminMatchRow => {
    const { weeks, ...match } = r;
    const season = weeks?.seasons ?? null;
    const weekNumber = weeks?.week_number ?? null;
    const win =
      season?.start_date && weekNumber != null ? weekWindow(season.start_date, weekNumber) : null;
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    return {
      match: match as Match,
      label: matchLabel({
        matchId: r.id,
        seasonName: season?.name ?? null,
        weekNumber,
        matchNumber: r.match_number,
      }),
      seasonNumber: season?.name ? extractSeasonNumber(season.name) : null,
      weekNumber,
      isGauntlet: season?.is_gauntlet ?? false,
      mapPool: season?.map_pool ?? null,
      weekStart: win ? fmt(win.start) : null,
      weekEnd: win ? fmt(win.end) : null,
    };
  });

  out.sort((a, b) =>
    compareMatchRefDesc(
      { seasonNumber: a.seasonNumber, isGauntlet: a.isGauntlet, weekNumber: a.weekNumber ?? 0, matchNumber: a.match.match_number ?? 0 },
      { seasonNumber: b.seasonNumber, isGauntlet: b.isGauntlet, weekNumber: b.weekNumber ?? 0, matchNumber: b.match.match_number ?? 0 },
    ),
  );
  return out;
}

/**
 * All players for the admin player console (#144), sorted by display name. Returns the full `Player`
 * row (name, `is_admin`, and the steam-link fields) so the console can edit them in place.
 */
export async function getAdminPlayers(): Promise<Player[]> {
  const { data, error } = await supabase.from('players').select('*').order('name');
  if (error || !data) return [];
  return data as Player[];
}

// ---------------------------------------------------------------------------
// Admin check
// ---------------------------------------------------------------------------

export async function isPlayerAdmin(playerId: number): Promise<boolean> {
  const { data } = await supabase
    .from('players')
    .select('is_admin')
    .eq('id', playerId)
    .maybeSingle();
  return !!(data as { is_admin?: boolean } | null)?.is_admin;
}
