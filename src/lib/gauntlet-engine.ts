/**
 * Runtime gauntlet bracket engine: materializes a pod's matches, and on each gauntlet score commit,
 * resolves the scored pod, propagates survivors into downstream slots, and materializes any pod
 * that just became fully filled. No stored state machine — a pod is waiting/playable/resolved
 * purely by reading `gauntlet_pod_slots.player_id` and the linked matches' `final_score`.
 *
 * Forward-only: a pod resolves exactly once (scores aren't edited after the fact), so this never
 * needs to un-propagate or re-materialize.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { isPlayedScore } from './util';
import type { AdvanceRule, BracketPlan } from './gauntlet-bracket';

export interface GauntletPodRow {
  id: number;
  season_id: number;
  round_number: number;
  pod_index: number;
  advance_rule: AdvanceRule;
  is_final: boolean;
  week_id: number | null;
  match1_id: number | null;
  match2_id: number | null;
}

type PlayerStatWin = { player_id: number; is_win: boolean };

/** Every player's original tournament seed, keyed by player_id — every occupant traces back to
 * exactly one 'seed'-sourced slot (their entry point, whether round 1 or a later bye). */
async function getSeedByPlayer(supabaseAdmin: SupabaseClient, seasonId: number): Promise<Map<number, number>> {
  // gauntlet_pod_slots has two FKs into gauntlet_pods (pod_id and source_pod_id), so the embed
  // is ambiguous without the `!pod_id` hint telling PostgREST which relationship to join on.
  const { data, error } = await supabaseAdmin
    .from('gauntlet_pods')
    .select('id, gauntlet_pod_slots!pod_id(source_kind, source_seed, player_id)')
    .eq('season_id', seasonId);
  if (error) throw error;
  const map = new Map<number, number>();
  for (const pod of (data ?? []) as { gauntlet_pod_slots: { source_kind: string; source_seed: number | null; player_id: number | null }[] }[]) {
    for (const slot of pod.gauntlet_pod_slots) {
      if (slot.source_kind === 'seed' && slot.player_id != null && slot.source_seed != null) {
        map.set(slot.player_id, slot.source_seed);
      }
    }
  }
  return map;
}

/** Creates the pod's two `matches` rows (+ 4 `player_match_stats` rows each) and links them back
 * onto `gauntlet_pods`. Pairing: rank 0-3 by seed (best first), game 1 = {0+3 vs 1+2}, game 2 =
 * {0+2 vs 1+3} — two distinct pairings so exactly one player goes 2-0 and one goes 0-2. Faction:
 * whichever pair contains the pod's top (best) seed is SHIRTS in both games. */
export async function materializePod(
  supabaseAdmin: SupabaseClient,
  pod: Pick<GauntletPodRow, 'id' | 'season_id' | 'round_number'>,
  occupants: { player_id: number }[],
  seedByPlayer: Map<number, number>,
): Promise<void> {
  const ranked = [...occupants].sort(
    (a, b) => (seedByPlayer.get(a.player_id) ?? Infinity) - (seedByPlayer.get(b.player_id) ?? Infinity),
  );
  const [r0, r1, r2, r3] = ranked;

  // Select-then-insert, not a DB-enforced upsert (weeks has no unique constraint on
  // (season_id, week_number)) — two concurrent first-materializations of the same round could each
  // insert their own week row. The gauntlet_pods claim below still prevents duplicate matches/stats
  // in that case; the worst outcome is an orphaned empty week row for the losing caller.
  const { data: existingWeek, error: weekSelErr } = await supabaseAdmin
    .from('weeks')
    .select('id')
    .eq('season_id', pod.season_id)
    .eq('week_number', pod.round_number)
    .maybeSingle();
  if (weekSelErr) throw weekSelErr;

  let weekId = (existingWeek as { id: number } | null)?.id ?? null;
  if (weekId == null) {
    const { data: newWeek, error: weekInsErr } = await supabaseAdmin
      .from('weeks')
      .insert({ season_id: pod.season_id, week_number: pod.round_number, bye_player_id: null })
      .select('id')
      .single();
    if (weekInsErr) throw weekInsErr;
    weekId = (newWeek as { id: number }).id;
  }

  const { data: existingMatches, error: matchSelErr } = await supabaseAdmin
    .from('matches')
    .select('match_number')
    .eq('week_id', weekId);
  if (matchSelErr) throw matchSelErr;
  const nextMatchNumber =
    1 + Math.max(0, ...((existingMatches ?? []) as { match_number: number }[]).map((m) => m.match_number));

  const games: { shirts: typeof ranked; skins: typeof ranked }[] = [
    { shirts: [r0, r3], skins: [r1, r2] },
    { shirts: [r0, r2], skins: [r1, r3] },
  ];

  const insertMatch = async (matchNumber: number) => {
    const { data: matchRow, error: matchInsErr } = await supabaseAdmin
      .from('matches')
      .insert({
        week_id: weekId,
        match_number: matchNumber,
        is_playoff_game: true,
        final_score: null,
        picked_map: null,
        shirts_ban: null,
        shirts_ban2: null,
        skins_ban1: null,
        skins_ban2: null,
        shirts_pick: null,
        skins_starting_side: null,
      })
      .select('id')
      .single();
    if (matchInsErr) throw matchInsErr;
    return (matchRow as { id: number }).id;
  };

  const insertStats = async (matchId: number, game: (typeof games)[number]) => {
    const zeroStats = { kills: 0, assists: 0, deaths: 0, damage: 0, adr: 0, rounds_played: 0, rounds_won: 0, is_win: false };
    const statRows = [
      ...game.shirts.map((o) => ({ match_id: matchId, player_id: o.player_id, faction: 'SHIRTS', ...zeroStats })),
      ...game.skins.map((o) => ({ match_id: matchId, player_id: o.player_id, faction: 'SKINS', ...zeroStats })),
    ];
    const { error: statsInsErr } = await supabaseAdmin.from('player_match_stats').insert(statRows);
    if (statsInsErr) throw statsInsErr;
  };

  // Create match 1 first, then atomically claim the pod with it before doing anything else. Two
  // concurrent resolveAndPropagate calls can both reach this point for the same downstream pod
  // (e.g. its last two feeder pods resolving within moments of each other) — the `.is('match1_id',
  // null)` guard means only one caller's update actually matches a row. The loser deletes its
  // orphaned match1 row and backs out before creating match 2 or any stats, so the pod is never
  // double-materialized.
  const match1Id = await insertMatch(nextMatchNumber);
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from('gauntlet_pods')
    .update({ week_id: weekId, match1_id: match1Id })
    .eq('id', pod.id)
    .is('match1_id', null)
    .select('id');
  if (claimErr) throw claimErr;
  if (!claimed || claimed.length === 0) {
    await supabaseAdmin.from('matches').delete().eq('id', match1Id);
    return;
  }

  await insertStats(match1Id, games[0]);
  const match2Id = await insertMatch(nextMatchNumber + 1);
  await insertStats(match2Id, games[1]);

  const { error: podUpdErr } = await supabaseAdmin
    .from('gauntlet_pods')
    .update({ match2_id: match2Id })
    .eq('id', pod.id);
  if (podUpdErr) throw podUpdErr;
}

/** Inserts all pods + slots for a freshly built bracket plan, resolves 'seed' slots to player_ids
 * from the seed snapshot, and materializes every pod whose slots are all seed-sourced (round 1,
 * plus any all-bye pod). Called once from the bracket creation route. */
export async function persistAndMaterializeBracket(
  supabaseAdmin: SupabaseClient,
  seasonId: number,
  plan: BracketPlan,
  playerBySeed: Map<number, number>,
): Promise<void> {
  const podIdByKey = new Map<string, number>();
  const key = (round: number, index: number) => `${round}:${index}`;

  for (const pod of plan.pods) {
    const { data, error } = await supabaseAdmin
      .from('gauntlet_pods')
      .insert({
        season_id: seasonId,
        round_number: pod.round_number,
        pod_index: pod.pod_index,
        advance_rule: pod.advance_rule,
        is_final: pod.is_final,
      })
      .select('id')
      .single();
    if (error) throw error;
    podIdByKey.set(key(pod.round_number, pod.pod_index), (data as { id: number }).id);
  }

  for (const pod of plan.pods) {
    const podId = podIdByKey.get(key(pod.round_number, pod.pod_index))!;
    const rows = pod.slots.map((slot) => ({
      pod_id: podId,
      slot_index: slot.slot_index,
      source_kind: slot.source_kind,
      source_seed: slot.source_kind === 'seed' ? slot.source_seed : null,
      source_pod_id:
        slot.source_kind === 'pod' ? podIdByKey.get(key(slot.source_round!, slot.source_pod_index!)) : null,
      player_id: slot.source_kind === 'seed' ? (playerBySeed.get(slot.source_seed!) ?? null) : null,
    }));
    const { error } = await supabaseAdmin.from('gauntlet_pod_slots').insert(rows);
    if (error) throw error;
  }

  const seedByPlayer = new Map<number, number>();
  for (const [seed, playerId] of playerBySeed) seedByPlayer.set(playerId, seed);

  for (const pod of plan.pods) {
    if (pod.slots.every((s) => s.source_kind === 'seed')) {
      const podId = podIdByKey.get(key(pod.round_number, pod.pod_index))!;
      const occupants = pod.slots.map((s) => ({ player_id: playerBySeed.get(s.source_seed!)! }));
      await materializePod(supabaseAdmin, { id: podId, season_id: seasonId, round_number: pod.round_number }, occupants, seedByPlayer);
    }
  }
}

/** Deletes a gauntlet season and everything materialized under it: pods/slots (cascade),
 * player_match_stats, matches, weeks, and the season row itself. Used both to clean up a failed
 * bracket build and to let an admin reset a gauntlet that hasn't started play yet — callers are
 * responsible for verifying it's safe to delete (e.g. no played matches) before calling this. */
export async function deleteGauntletSeason(supabaseAdmin: SupabaseClient, gauntletSeasonId: number): Promise<void> {
  const { error: podsErr } = await supabaseAdmin.from('gauntlet_pods').delete().eq('season_id', gauntletSeasonId);
  if (podsErr) throw podsErr;

  const { data: weekRows, error: weekSelErr } = await supabaseAdmin
    .from('weeks')
    .select('id')
    .eq('season_id', gauntletSeasonId);
  if (weekSelErr) throw weekSelErr;
  const weekIds = ((weekRows ?? []) as { id: number }[]).map((w) => w.id);

  if (weekIds.length > 0) {
    const { data: matchRows, error: matchSelErr } = await supabaseAdmin
      .from('matches')
      .select('id')
      .in('week_id', weekIds);
    if (matchSelErr) throw matchSelErr;
    const matchIds = ((matchRows ?? []) as { id: number }[]).map((m) => m.id);

    if (matchIds.length > 0) {
      const { error: statsErr } = await supabaseAdmin.from('player_match_stats').delete().in('match_id', matchIds);
      if (statsErr) throw statsErr;
      const { error: matchDelErr } = await supabaseAdmin.from('matches').delete().in('id', matchIds);
      if (matchDelErr) throw matchDelErr;
    }

    const { error: weekDelErr } = await supabaseAdmin.from('weeks').delete().in('id', weekIds);
    if (weekDelErr) throw weekDelErr;
  }

  const { error: seasonDelErr } = await supabaseAdmin.from('seasons').delete().eq('id', gauntletSeasonId);
  if (seasonDelErr) throw seasonDelErr;
}

/** Called from the score route's post-commit hook for every gauntlet match. No-op if the match
 * isn't part of a pod, if the pod's other match isn't played yet, or if the pod is the final
 * (nobody advances from it — canonicalGauntletRankMap computes the podium on read). */
export async function resolveAndPropagate(supabaseAdmin: SupabaseClient, matchId: number): Promise<void> {
  const { data: podRow, error: podErr } = await supabaseAdmin
    .from('gauntlet_pods')
    .select('id, season_id, round_number, pod_index, advance_rule, is_final, week_id, match1_id, match2_id')
    .or(`match1_id.eq.${matchId},match2_id.eq.${matchId}`)
    .maybeSingle();
  if (podErr) throw podErr;
  const pod = podRow as GauntletPodRow | null;
  if (!pod || pod.is_final || pod.match1_id == null || pod.match2_id == null) return;

  const { data: matches, error: matchesErr } = await supabaseAdmin
    .from('matches')
    .select('id, final_score')
    .in('id', [pod.match1_id, pod.match2_id]);
  if (matchesErr) throw matchesErr;
  const matchRows = (matches ?? []) as { id: number; final_score: string | null }[];
  if (matchRows.length !== 2 || !matchRows.every((m) => isPlayedScore(m.final_score))) return;

  const { data: stats, error: statsErr } = await supabaseAdmin
    .from('player_match_stats')
    .select('player_id, is_win')
    .in('match_id', [pod.match1_id, pod.match2_id]);
  if (statsErr) throw statsErr;

  const winsByPlayer = new Map<number, number>();
  for (const s of (stats ?? []) as PlayerStatWin[]) {
    winsByPlayer.set(s.player_id, (winsByPlayer.get(s.player_id) ?? 0) + (s.is_win ? 1 : 0));
  }

  const survivors =
    pod.advance_rule === 'single'
      ? [...winsByPlayer.entries()].filter(([, wins]) => wins === 2).map(([id]) => id)
      : [...winsByPlayer.entries()].filter(([, wins]) => wins > 0).map(([id]) => id);

  if (survivors.length === 0) return; // shouldn't happen given the pairing invariant; defensive no-op

  const { data: downstreamSlots, error: slotsErr } = await supabaseAdmin
    .from('gauntlet_pod_slots')
    .select('id, pod_id')
    .eq('source_pod_id', pod.id);
  if (slotsErr) throw slotsErr;
  const slots = (downstreamSlots ?? []) as { id: number; pod_id: number }[];
  if (slots.length === 0) return;

  for (let i = 0; i < slots.length && i < survivors.length; i++) {
    const { error } = await supabaseAdmin
      .from('gauntlet_pod_slots')
      .update({ player_id: survivors[i] })
      .eq('id', slots[i].id);
    if (error) throw error;
  }

  const downstreamPodIds = [...new Set(slots.map((s) => s.pod_id))];
  for (const downstreamPodId of downstreamPodIds) {
    const { data: allSlots, error: allSlotsErr } = await supabaseAdmin
      .from('gauntlet_pod_slots')
      .select('player_id')
      .eq('pod_id', downstreamPodId);
    if (allSlotsErr) throw allSlotsErr;
    const occupants = (allSlots ?? []) as { player_id: number | null }[];
    if (occupants.length !== 4 || occupants.some((o) => o.player_id == null)) continue;

    const { data: downstreamPod, error: dpErr } = await supabaseAdmin
      .from('gauntlet_pods')
      .select('id, season_id, round_number, match1_id')
      .eq('id', downstreamPodId)
      .single();
    if (dpErr) throw dpErr;
    const dp = downstreamPod as { id: number; season_id: number; round_number: number; match1_id: number | null };
    if (dp.match1_id != null) continue; // already materialized

    const seedByPlayer = await getSeedByPlayer(supabaseAdmin, pod.season_id);
    await materializePod(
      supabaseAdmin,
      { id: dp.id, season_id: dp.season_id, round_number: dp.round_number },
      occupants.map((o) => ({ player_id: o.player_id! })),
      seedByPlayer,
    );
  }
}
