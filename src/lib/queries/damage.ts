import { supabase } from '../supabase';
import { fetchAllPages, fetchPmsLookup, type PmsRow } from './_shared';

/** One `match_damage_events` row, joined to player ids — the match-page-scoped counterpart of
 *  `getMatchKills()` (`queries/kills.ts`), for views that need actual damage dealt between
 *  specific players rather than each player's own damage total (`player_match_stats.damage`). */
export interface MatchDamageEventRow {
  match_id: number;
  round_number: number;
  attacker_player_id: number | null;
  victim_player_id: number;
  weapon: string;
  damage: number;
  hitgroup: string;
  tick: number;
}

type RawDamageRow = {
  match_id: number;
  round_number: number;
  attacker_player_match_stats_id: number | null;
  victim_player_match_stats_id: number;
  weapon: string;
  damage: number;
  hitgroup: string;
  tick: number;
};

function joinDamageRows(rows: RawDamageRow[], pmsLookup: Map<number, PmsRow>): MatchDamageEventRow[] {
  const result: MatchDamageEventRow[] = [];
  for (const r of rows) {
    const victimPms = pmsLookup.get(r.victim_player_match_stats_id);
    if (!victimPms) continue;
    const attackerPms =
      r.attacker_player_match_stats_id != null ? pmsLookup.get(r.attacker_player_match_stats_id) : undefined;
    result.push({
      match_id: r.match_id,
      round_number: r.round_number,
      attacker_player_id: attackerPms?.player_id ?? null,
      victim_player_id: victimPms.player_id,
      weapon: r.weapon,
      damage: r.damage,
      hitgroup: r.hitgroup,
      tick: r.tick,
    });
  }
  return result;
}

/** One match's recorded damage events (`match_damage_events`), joined to player ids. `damage` is
 *  health actually lost, clamped to what the victim had left that round (see `architecture.md`'s
 *  `match_damage_events` row) — self-damage and teamdamage are kept, not filtered. */
export async function getMatchDamageEvents(matchId: number): Promise<MatchDamageEventRow[]> {
  const [rows, pmsLookup] = await Promise.all([
    fetchAllPages<RawDamageRow>((from, to) =>
      supabase.from('match_damage_events').select('*').eq('match_id', matchId).range(from, to),
    ),
    fetchPmsLookup(matchId),
  ]);
  return joinDamageRows(rows, pmsLookup);
}
