import { supabase } from '../supabase';
import { resolveMatchSeasons, fetchAllPages, asPage } from './_shared';
import type { Faction, RoundCondition } from '../types';
import { buildPlayerFactionsAndRoster, deriveNinjaDefuseRounds, type NinjaVictim } from './kills';

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
type RawPmsFactionRow = { id: number; player_id: number; match_id: number; faction: Faction };

/** Every recorded round outcome (`match_rounds`), joined to season — the raw ingredient behind
 *  round-win-%-by-side. Flat, ungrouped, matching `getAllMatchKills()`'s pattern. Also resolves
 *  `ninja` per round (`deriveNinjaDefuseRounds()`), which needs `match_kills`/`player_match_stats`
 *  faction data beyond `match_rounds` itself — fetched here rather than pushed onto every caller. */
export async function getAllMatchRounds(seasonId?: number): Promise<MatchRoundRow[]> {
  const [roundRows, matchSeason, killRows, pmsRows] = await Promise.all([
    fetchAllPages<RawRoundRow>((from, to) => supabase.from('match_rounds').select('*').range(from, to)),
    resolveMatchSeasons(),
    fetchAllPages<RawKillVictimRow>((from, to) =>
      asPage(supabase.from('match_kills').select('match_id, round_number, victim_player_match_stats_id').range(from, to)),
    ),
    fetchAllPages<RawPmsFactionRow>((from, to) =>
      asPage(supabase.from('player_match_stats').select('id, player_id, match_id, faction').range(from, to)),
    ),
  ]);

  const pmsById = new Map(pmsRows.map((r) => [r.id, r]));
  const victims: NinjaVictim[] = [];
  for (const k of killRows) {
    const pms = pmsById.get(k.victim_player_match_stats_id);
    if (!pms) continue;
    victims.push({ match_id: k.match_id, round_number: k.round_number, victim_player_id: pms.player_id });
  }
  const { playerFactions, rosterByMatch } = buildPlayerFactionsAndRoster(pmsRows);
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
    if (seasonId != null && sid !== seasonId) continue;
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

export interface RoundSideInfo {
  shirtsSide: 'CT' | 'T';
  winnerSide: 'CT' | 'T';
}

/** Every round's `shirts_side`/`winner_side`, keyed by `` `${match_id}:${round_number}` `` — the raw
 *  ingredient `resolvePlayerSide()` (`queries/kills.ts`) needs to resolve which side a player was on
 *  a given round, plus which side won it (`deriveClutchCounts()`'s win/loss check). No season
 *  resolution or `win_reason` join, unlike `getAllMatchRounds()` — side-split/clutch derivation
 *  doesn't need either, the same reasoning `getAllKillCreditFlags()` (`queries/kills.ts`) uses to
 *  skip `getAllMatchKills()`'s season/name joins. Pass `matchId` to scope to one match. */
export async function getRoundSides(matchId?: number): Promise<Map<string, RoundSideInfo>> {
  const rows = await fetchAllPages<{ match_id: number; round_number: number; shirts_side: string; winner_side: string }>(
    (from, to) => {
      let q = supabase.from('match_rounds').select('match_id, round_number, shirts_side, winner_side');
      if (matchId != null) q = q.eq('match_id', matchId);
      return q.range(from, to);
    },
  );
  return new Map(rows.map((r) => [
    `${r.match_id}:${r.round_number}`,
    { shirtsSide: r.shirts_side as 'CT' | 'T', winnerSide: r.winner_side as 'CT' | 'T' },
  ]));
}
