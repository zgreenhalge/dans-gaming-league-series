import { cache } from 'react';
import { supabase } from '../supabase';
import {
  resolveMatchSeasons, fetchAllPages, asPage, fetchPmsFactionLookup,
  buildPlayerFactionsAndRoster, getRoundSides, type RoundSideInfo,
} from './_shared';
import type { RoundCondition } from '../types';
import { deriveNinjaDefuseRounds, type NinjaVictim } from './kills';

export { getRoundSides, type RoundSideInfo };

export interface MatchRoundRow {
  match_id: number;
  season_id: number;
  round_number: number;
  winner_side: 'CT' | 'T';
  shirts_side: 'CT' | 'T';
  /** Null only for a `match_rounds` row predating this column, or a parser miss — see
   *  `aggregateWinConditions()` (`src/lib/mapSideStats.ts`), which excludes those rounds rather
   *  than guessing a condition. */
  win_reason: RoundCondition | null;
  /** True for a defuse win with at least one T-side player still alive — see
   *  `deriveNinjaDefuseRounds()` (`queries/kills.ts`). Always false for every other `win_reason`. */
  ninja: boolean;
}

type RawRoundRow = {
  match_id: number;
  round_number: number;
  winner_side: string;
  shirts_side: string;
  win_reason: string | null;
};

type RawKillVictimRow = { match_id: number; round_number: number; victim_player_match_stats_id: number };

/** Every recorded round outcome (`match_rounds`), joined to season, for every season at once —
 *  the raw ingredient behind round-win-%-by-side. Flat, ungrouped, matching `getAllMatchKills()`'s
 *  pattern. Also resolves `ninja` per round (`deriveNinjaDefuseRounds()`), which needs
 *  `match_kills`/`player_match_stats` faction data beyond `match_rounds` itself — fetched here
 *  rather than pushed onto every caller. Wrapped in React's `cache()` (#507): `getAllMatchRounds()`
 *  filters this same season-independent computation down to `seasonId` rather than each distinct
 *  `seasonId` re-running its own `match_rounds`/`match_kills` scan. */
const fetchAllMatchRoundRows = cache(async (): Promise<MatchRoundRow[]> => {
  const [roundRows, matchSeason, killRows, pmsFactionLookup] = await Promise.all([
    fetchAllPages<RawRoundRow>((from, to) => supabase.from('match_rounds').select('*').range(from, to)),
    resolveMatchSeasons(),
    fetchAllPages<RawKillVictimRow>((from, to) =>
      asPage(supabase.from('match_kills').select('match_id, round_number, victim_player_match_stats_id').range(from, to)),
    ),
    fetchPmsFactionLookup(),
  ]);

  const victims: NinjaVictim[] = [];
  for (const k of killRows) {
    const pms = pmsFactionLookup.get(k.victim_player_match_stats_id);
    if (!pms) continue;
    victims.push({ match_id: k.match_id, round_number: k.round_number, victim_player_id: pms.player_id });
  }
  const { playerFactions, rosterByMatch } = buildPlayerFactionsAndRoster([...pmsFactionLookup.values()]);
  // Built inline from `roundRows` (already fetched above) rather than a `getRoundSides()` call —
  // that would just re-fetch `match_rounds` a second time for the same rows.
  const roundSides = new Map(roundRows.map((r) => [
    `${r.match_id}:${r.round_number}`,
    { shirtsSide: r.shirts_side as 'CT' | 'T', winnerSide: r.winner_side as 'CT' | 'T' },
  ]));
  const ninjaRounds = deriveNinjaDefuseRounds(
    roundRows.map((r) => ({
      match_id: r.match_id,
      round_number: r.round_number,
      winner_side: r.winner_side as 'CT' | 'T',
      win_reason: r.win_reason as RoundCondition | null,
    })),
    victims,
    roundSides,
    playerFactions,
    rosterByMatch,
  );

  const result: MatchRoundRow[] = [];
  for (const r of roundRows) {
    const sid = matchSeason.get(r.match_id);
    if (sid == null) continue;
    result.push({
      match_id: r.match_id,
      season_id: sid,
      round_number: r.round_number,
      winner_side: r.winner_side as 'CT' | 'T',
      shirts_side: r.shirts_side as 'CT' | 'T',
      win_reason: r.win_reason as RoundCondition | null,
      ninja: ninjaRounds.has(`${r.match_id}:${r.round_number}`),
    });
  }
  return result;
});

/** `fetchAllMatchRoundRows()` filtered to one season — pass `seasonId` to scope to a single
 *  (regular or gauntlet) season; omit it for every season's rounds at once. */
export async function getAllMatchRounds(seasonId?: number): Promise<MatchRoundRow[]> {
  const rows = await fetchAllMatchRoundRows();
  return seasonId == null ? rows : rows.filter((r) => r.season_id === seasonId);
}

/** Groups rounds by `match_id` — the shape `aggregatePlayerSideStats()`'s `roundsByMatch` param
 *  and `BasicStatsView`'s per-match lookups both want. */
export function groupRoundsByMatch(rounds: MatchRoundRow[]): Map<number, MatchRoundRow[]> {
  const byMatch = new Map<number, MatchRoundRow[]>();
  for (const r of rounds) {
    let list = byMatch.get(r.match_id);
    if (!list) {
      list = [];
      byMatch.set(r.match_id, list);
    }
    list.push(r);
  }
  return byMatch;
}
