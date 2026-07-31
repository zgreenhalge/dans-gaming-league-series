import { supabase } from '../supabase';
import type { Player } from '../types';
import { getPlayersById } from './player';
import type { DraftScheduleWeek } from '../season-schedule-validation';

export interface DraftMatchWithPlayers {
  id: number;
  match_number: number;
  shirts: [Player, Player];
  skins: [Player, Player];
}

export interface DraftWeekWithMatches {
  id: number;
  week_number: number;
  bye_player: Player | null;
  matches: DraftMatchWithPlayers[];
}

/** A season's editable matchup draft (`season_schedule_draft_weeks`/`_matches`), fully joined to
 * player rows for display — empty until `generateSeasonScheduleDraft()` (or a hand-built draft)
 * exists for the season. */
export async function getSeasonScheduleDraft(seasonId: number): Promise<DraftWeekWithMatches[]> {
  const [{ data: weekRows, error: weekErr }, playersById] = await Promise.all([
    supabase
      .from('season_schedule_draft_weeks')
      .select('id, week_number, bye_player_id')
      .eq('season_id', seasonId)
      .order('week_number', { ascending: true }),
    getPlayersById(),
  ]);
  if (weekErr) throw weekErr;

  type WeekRow = { id: number; week_number: number; bye_player_id: number | null };
  const weeks = (weekRows ?? []) as WeekRow[];
  if (weeks.length === 0) return [];

  const weekIds = weeks.map((w) => w.id);
  const { data: matchRows, error: matchErr } = await supabase
    .from('season_schedule_draft_matches')
    .select('id, draft_week_id, match_number, shirts_player1_id, shirts_player2_id, skins_player1_id, skins_player2_id')
    .in('draft_week_id', weekIds)
    .order('match_number', { ascending: true });
  if (matchErr) throw matchErr;

  type MatchRow = {
    id: number;
    draft_week_id: number;
    match_number: number;
    shirts_player1_id: number;
    shirts_player2_id: number;
    skins_player1_id: number;
    skins_player2_id: number;
  };
  const matchesByWeek = new Map<number, MatchRow[]>();
  for (const m of (matchRows ?? []) as MatchRow[]) {
    const list = matchesByWeek.get(m.draft_week_id) ?? [];
    list.push(m);
    matchesByWeek.set(m.draft_week_id, list);
  }

  const player = (id: number): Player => {
    const p = playersById.get(id);
    if (!p) throw new Error(`getSeasonScheduleDraft: player_id ${id} not found`);
    return p;
  };

  return weeks.map((w) => ({
    id: w.id,
    week_number: w.week_number,
    bye_player: w.bye_player_id != null ? player(w.bye_player_id) : null,
    matches: (matchesByWeek.get(w.id) ?? []).map((m) => ({
      id: m.id,
      match_number: m.match_number,
      shirts: [player(m.shirts_player1_id), player(m.shirts_player2_id)] as [Player, Player],
      skins: [player(m.skins_player1_id), player(m.skins_player2_id)] as [Player, Player],
    })),
  }));
}

/** Player-joined draft (`getSeasonScheduleDraft()`'s shape) down to the plain-id shape
 * `validateDraftIntegrity()`/`validateDraftCompleteness()`/`saveSeasonScheduleDraft()` operate on —
 * shared by `confirmSeasonScheduleDraft()` and the manual editor page rather than each re-deriving
 * the same player-object-to-id mapping. */
export function toDraftScheduleWeeks(weeks: DraftWeekWithMatches[]): DraftScheduleWeek[] {
  return weeks.map((w) => ({
    week_number: w.week_number,
    bye_player_id: w.bye_player?.id ?? null,
    matches: w.matches.map((m) => ({
      match_number: m.match_number,
      shirts: [m.shirts[0].id, m.shirts[1].id] as [number, number],
      skins: [m.skins[0].id, m.skins[1].id] as [number, number],
    })),
  }));
}
