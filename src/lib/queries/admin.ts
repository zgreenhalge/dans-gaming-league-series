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
  /** The other match in this one's gauntlet pod, if any — null for a non-gauntlet match or a
   *  gauntlet match with no resolvable pod. Excluded from the schedule editor's own collision
   *  candidates (the two are intentionally 30 minutes apart on the one server). */
  podSiblingId: number | null;
  /** 1 or 2 — which of the pod's two games this is (by materialization order), null when
   *  `podSiblingId` is null. Only game 1 sets the pod's schedule (`PATCH /api/matches/[id]/schedule`
   *  writes both games' `scheduled_at` from a single "pod start" time); game 2 is read-only,
   *  always 30 minutes after game 1. */
  podGameNumber: 1 | 2 | null;
}

/**
 * Every match with the context the admin match console (#144) needs to reschedule, clear/redo the
 * pick-ban, or toggle the feature flag: the full row plus season/week labels, map pool, gauntlet flag,
 * and week window. Sorted newest (season → week → match) first — same canonical order as the rest of
 * the site. Admin-only surface; the page gates access.
 */
export async function getAdminMatches(): Promise<AdminMatchRow[]> {
  const [{ data, error }, { data: podRows }] = await Promise.all([
    supabase.from('matches').select('*, weeks(week_number, seasons(name, is_gauntlet, map_pool, start_date))'),
    supabase.from('gauntlet_pods').select('match1_id, match2_id'),
  ]);
  if (error || !data) return [];

  const podSiblingByMatchId = new Map<number, number>();
  const podGameNumberByMatchId = new Map<number, 1 | 2>();
  for (const p of (podRows ?? []) as { match1_id: number | null; match2_id: number | null }[]) {
    if (p.match1_id != null && p.match2_id != null) {
      podSiblingByMatchId.set(p.match1_id, p.match2_id);
      podSiblingByMatchId.set(p.match2_id, p.match1_id);
      podGameNumberByMatchId.set(p.match1_id, 1);
      podGameNumberByMatchId.set(p.match2_id, 2);
    }
  }

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
      podSiblingId: podSiblingByMatchId.get(r.id) ?? null,
      podGameNumber: podGameNumberByMatchId.get(r.id) ?? null,
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
