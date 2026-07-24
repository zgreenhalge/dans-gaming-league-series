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
import { allMatchesPlayed, extractSeasonNumber } from './util';
import { buildGauntletBracket, type AdvanceRule, type BracketPlan } from './gauntlet-bracket';
import {
  getSeason,
  getSeasonLeaderboard,
  getLinkedGauntlet,
  getLinkedRegularSeason,
  getGauntletRounds,
  getGauntletBracketShape,
} from './queries';
import { clearOpsError } from './ops-errors';
import { validateIntegrity, type DraftPod } from './gauntlet-draft';

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

/** Inserts all pods + slots for a freshly built bracket plan. Every slot's `player_id` is left
 * null, including 'seed' slots — the shape only encodes qualifier count, not who qualified, so it
 * can be built as soon as the regular season's roster is fixed (its full match schedule exists),
 * well before standings are final. Nothing is materialized; nothing is playable yet. Call
 * `seedBracket()` once seeds are known to fill it in. */
export async function persistBracketShape(
  supabaseAdmin: SupabaseClient,
  seasonId: number,
  plan: BracketPlan,
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
      player_id: null,
    }));
    const { error } = await supabaseAdmin.from('gauntlet_pod_slots').insert(rows);
    if (error) throw error;
  }
}

/** All `gauntlet_pods.id` rows for a season — the two-step "get pod ids, then filter slots by
 * them" shape used throughout this file, since `gauntlet_pod_slots` has two FKs into
 * `gauntlet_pods` (`pod_id` and `source_pod_id`), making a direct embedded join ambiguous. */
async function getPodIds(supabaseAdmin: SupabaseClient, seasonId: number): Promise<number[]> {
  const { data, error } = await supabaseAdmin.from('gauntlet_pods').select('id').eq('season_id', seasonId);
  if (error) throw error;
  return ((data ?? []) as { id: number }[]).map((p) => p.id);
}

export interface SeedBands {
  /** Seeds that play round 1. */
  round1: number[];
  /** Seeds whose only seed-sourced slot is in a later round (bye straight past round 1). */
  byes: number[];
  /** Seeds with no seed-sourced slot anywhere in the bracket (relegated at build time). */
  dropped: number[];
}

/** Derives which seeds play round 1, which bye past it, and which were dropped entirely, from the
 * persisted shape alone — works whether or not it's been seeded yet. `round1.length + byes.length`
 * is the qualifier count N the shape was built for, used by `seedBracket()`'s caller to catch a
 * roster that's drifted since the shape was built. */
export async function getSeedBands(
  supabaseAdmin: SupabaseClient,
  seasonId: number,
  qualifierCount: number,
): Promise<SeedBands> {
  const { data: pods, error: podsErr } = await supabaseAdmin
    .from('gauntlet_pods')
    .select('id, round_number')
    .eq('season_id', seasonId);
  if (podsErr) throw podsErr;
  const podRows = (pods ?? []) as { id: number; round_number: number }[];
  const roundByPodId = new Map(podRows.map((p) => [p.id, p.round_number]));
  const podIds = podRows.map((p) => p.id);
  if (podIds.length === 0) {
    return { round1: [], byes: [], dropped: Array.from({ length: qualifierCount }, (_, i) => i + 1) };
  }

  // `source_seed IS NOT NULL` matters here: a manually-placed slot (`GauntletPodEditor`) is also
  // `source_kind: 'seed'`, but carries a real `player_id` and no abstract seed number at all — only
  // a generator-built shape's seed slots (numbered, resolved later by `seedBracket()`) belong in
  // this accounting. Without this filter, a manual gauntlet's slots would push `null` into
  // `source_seed` below and corrupt the round1/byes/dropped bands.
  const { data: seedSlots, error: slotsErr } = await supabaseAdmin
    .from('gauntlet_pod_slots')
    .select('pod_id, source_seed')
    .eq('source_kind', 'seed')
    .not('source_seed', 'is', null)
    .in('pod_id', podIds);
  if (slotsErr) throw slotsErr;

  const round1: number[] = [];
  const byes: number[] = [];
  const seenSeeds = new Set<number>();
  for (const slot of (seedSlots ?? []) as { pod_id: number; source_seed: number }[]) {
    seenSeeds.add(slot.source_seed);
    if (roundByPodId.get(slot.pod_id) === 1) round1.push(slot.source_seed);
    else byes.push(slot.source_seed);
  }
  const dropped: number[] = [];
  for (let seed = 1; seed <= qualifierCount; seed++) {
    if (!seenSeeds.has(seed)) dropped.push(seed);
  }

  return {
    round1: round1.sort((a, b) => a - b),
    byes: byes.sort((a, b) => a - b),
    dropped,
  };
}

/** Materializes a pod if all four of its slots are now filled and it hasn't been materialized
 * already — shared by the seeding step (which can immediately ready round 1, or any all-bye pod)
 * and the propagation hook (which readies later pods as their feeders resolve). */
async function materializeIfReady(supabaseAdmin: SupabaseClient, podId: number): Promise<void> {
  const { data: allSlots, error: allSlotsErr } = await supabaseAdmin
    .from('gauntlet_pod_slots')
    .select('player_id')
    .eq('pod_id', podId);
  if (allSlotsErr) throw allSlotsErr;
  const occupants = (allSlots ?? []) as { player_id: number | null }[];
  if (occupants.length !== 4 || occupants.some((o) => o.player_id == null)) return;

  const { data: podRow, error: podErr } = await supabaseAdmin
    .from('gauntlet_pods')
    .select('id, season_id, round_number, match1_id')
    .eq('id', podId)
    .single();
  if (podErr) throw podErr;
  const pod = podRow as { id: number; season_id: number; round_number: number; match1_id: number | null };
  if (pod.match1_id != null) return; // already materialized

  const seedByPlayer = await getSeedByPlayer(supabaseAdmin, pod.season_id);
  await materializePod(
    supabaseAdmin,
    { id: pod.id, season_id: pod.season_id, round_number: pod.round_number },
    occupants.map((o) => ({ player_id: o.player_id! })),
    seedByPlayer,
  );
}

/** Fills in every 'seed'-sourced slot of an already-built bracket shape from the given seed →
 * player snapshot, then materializes every pod that becomes fully filled as a result (round 1,
 * plus any all-bye pod). Call once the regular season's standings are final — nothing about the
 * shape itself needs to change, only the previously-null seed slots. */
export async function seedBracket(
  supabaseAdmin: SupabaseClient,
  seasonId: number,
  playerBySeed: Map<number, number>,
): Promise<void> {
  const podIds = await getPodIds(supabaseAdmin, seasonId);
  const { data: seedSlots, error: seedSlotsErr } =
    podIds.length === 0
      ? { data: [], error: null }
      : await supabaseAdmin
          .from('gauntlet_pod_slots')
          .select('id, pod_id, source_seed')
          .eq('source_kind', 'seed')
          .in('pod_id', podIds);
  if (seedSlotsErr) throw seedSlotsErr;
  const slots = (seedSlots ?? []) as { id: number; pod_id: number; source_seed: number }[];

  for (const slot of slots) {
    const playerId = playerBySeed.get(slot.source_seed);
    if (playerId == null) continue;
    const { error } = await supabaseAdmin.from('gauntlet_pod_slots').update({ player_id: playerId }).eq('id', slot.id);
    if (error) throw error;
  }

  const affectedPodIds = [...new Set(slots.map((s) => s.pod_id))];
  for (const podId of affectedPodIds) {
    await materializeIfReady(supabaseAdmin, podId);
  }
}

/** Deletes a gauntlet season and everything materialized under it: pod slots, pods,
 * player_match_stats, matches, weeks, and the season row itself. Slots are deleted before pods
 * since `gauntlet_pod_slots` has two FKs into `gauntlet_pods` (`pod_id` and `source_pod_id`) and
 * there's no ON DELETE CASCADE on either. If its paired regular season was
 * ARCHIVED (i.e. this gauntlet had already completed and archived it via `checkGauntletCompletion`),
 * reverts that season back to COMPLETED — an archived season with no gauntlet behind it is a
 * confusing dead end. Also clears any stale build/seed `ops_errors` on the regular season, and any
 * stale archive `ops_errors` on the gauntlet season itself (otherwise it'd outlive the row it
 * references and show up as a phantom "Season #N" entry) — resetting the gauntlet is the recovery
 * action for a roster-drift seed failure, so a fresh start shouldn't carry the old failure forward.
 * Used both to clean up a failed bracket build and to let an admin reset a gauntlet — callers are
 * responsible for deciding whether it's safe to delete (e.g. force-clearing one that has already
 * started play) before calling this. */
export async function deleteGauntletSeason(supabaseAdmin: SupabaseClient, gauntletSeasonId: number): Promise<void> {
  const { data: gauntletRow, error: gauntletSelErr } = await supabaseAdmin
    .from('seasons')
    .select('name')
    .eq('id', gauntletSeasonId)
    .maybeSingle();
  if (gauntletSelErr) throw gauntletSelErr;
  const gauntletName = (gauntletRow as { name: string } | null)?.name ?? null;

  const podIds = await getPodIds(supabaseAdmin, gauntletSeasonId);
  if (podIds.length > 0) {
    const { error: slotsErr } = await supabaseAdmin.from('gauntlet_pod_slots').delete().in('pod_id', podIds);
    if (slotsErr) throw slotsErr;
  }
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

  await clearOpsError(supabaseAdmin, 'season', gauntletSeasonId, 'gauntlet_archive');

  if (gauntletName) {
    const regularSeason = await getLinkedRegularSeason(gauntletName);
    if (regularSeason) {
      if (regularSeason.status === 'ARCHIVED') {
        const { error: revertErr } = await supabaseAdmin
          .from('seasons')
          .update({ status: 'COMPLETED' })
          .eq('id', regularSeason.id);
        if (revertErr) throw revertErr;
      }
      await clearOpsError(supabaseAdmin, 'season', regularSeason.id, 'gauntlet_build');
      await clearOpsError(supabaseAdmin, 'season', regularSeason.id, 'gauntlet_seed');
    }
  }
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
  if (matchRows.length !== 2 || !allMatchesPlayed(matchRows)) return;

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
    await materializeIfReady(supabaseAdmin, downstreamPodId);
  }
}

type CreateSeasonRowResult =
  | { status: 'created'; gauntletSeasonId: number }
  | { status: 'already-exists' }
  | { status: 'not-eligible'; reason: string };

/** Parses the gauntlet name from an already-validated regular season and inserts its paired
 * "Season N Gauntlet" row. Callers own the "regular season exists" / "not already linked" checks —
 * this only does the name-parse + insert, so `tryBuildGauntletShape` and `saveManualDraft` can
 * order those checks around their own extra validation (bracket-plan computation, for the
 * automated path) without duplicating them here. */
async function createGauntletSeasonRow(
  supabaseAdmin: SupabaseClient,
  regularSeason: { name: string; target_win_rounds: number },
  opts: { startDate?: string | null } = {},
): Promise<CreateSeasonRowResult> {
  const seasonNumber = extractSeasonNumber(regularSeason.name);
  if (seasonNumber == null) {
    return { status: 'not-eligible', reason: `Could not parse a season number from "${regularSeason.name}"` };
  }
  const gauntletName = `Season ${seasonNumber} Gauntlet`;

  const { data: gauntletSeason, error: insertErr } = await supabaseAdmin
    .from('seasons')
    .insert({
      name: gauntletName,
      is_gauntlet: true,
      status: 'ACTIVE',
      start_date: opts.startDate ?? null,
      target_win_rounds: regularSeason.target_win_rounds,
    })
    .select('id')
    .single();
  if (insertErr) throw insertErr;

  return { status: 'created', gauntletSeasonId: (gauntletSeason as { id: number }).id };
}

export type BuildShapeResult =
  | { status: 'built'; gauntletSeasonId: number; qualifiers: number; games: number; rounds: number }
  | { status: 'already-exists' }
  | { status: 'not-eligible'; reason: string };

/** Creates the paired "Season N Gauntlet" season row and persists an unseeded bracket shape sized
 * from the regular season's current roster. Shared by the admin creation route and
 * `activateSeason()`'s auto-build — both just need to interpret the result differently. */
export async function tryBuildGauntletShape(
  supabaseAdmin: SupabaseClient,
  regularSeasonId: number,
  opts: { startDate?: string | null } = {},
): Promise<BuildShapeResult> {
  const regularSeason = await getSeason(regularSeasonId);
  if (!regularSeason || regularSeason.is_gauntlet) {
    return { status: 'not-eligible', reason: 'Regular season not found' };
  }

  const existingGauntlet = await getLinkedGauntlet(regularSeason.name);
  if (existingGauntlet) return { status: 'already-exists' };

  const leaderboard = await getSeasonLeaderboard(regularSeasonId);
  const N = leaderboard.length;

  let plan: BracketPlan;
  try {
    plan = buildGauntletBracket(N);
  } catch (err) {
    return { status: 'not-eligible', reason: (err as Error).message };
  }

  const created = await createGauntletSeasonRow(supabaseAdmin, regularSeason, opts);
  if (created.status !== 'created') return created;
  const { gauntletSeasonId } = created;

  try {
    await persistBracketShape(supabaseAdmin, gauntletSeasonId, plan);
  } catch (err) {
    // Best-effort cleanup so a retry isn't permanently blocked by the "already has a gauntlet"
    // check above.
    await deleteGauntletSeason(supabaseAdmin, gauntletSeasonId).catch((cleanupErr) => {
      console.error(`gauntlet build cleanup(${gauntletSeasonId}) failed:`, cleanupErr);
    });
    throw err;
  }

  await clearOpsError(supabaseAdmin, 'season', regularSeasonId, 'gauntlet_build');

  return {
    status: 'built',
    gauntletSeasonId,
    qualifiers: N,
    games: plan.games,
    rounds: Math.max(...plan.pods.map((p) => p.round_number)),
  };
}

export type SaveDraftResult =
  | { status: 'saved'; gauntletSeasonId: number }
  | { status: 'invalid'; errors: string[] }
  | { status: 'not-eligible'; reason: string };

/** Reconciles the manual pod editor's (`GauntletPodEditor`) current draft against whatever's
 * already persisted for this season's gauntlet — creating the paired "Season N Gauntlet" row on
 * the first save, inserting new pods, updating or deleting not-yet-materialized ones that changed
 * or were removed, and leaving materialized pods untouched. The client already ran
 * `pruneInvalidReferences()` (`gauntlet-draft.ts`) so the submitted draft is internally
 * self-consistent by construction — this only re-validates defensively (`validateIntegrity()`)
 * rather than repeating cascade-clearing logic server-side. */
export async function saveManualDraft(
  supabaseAdmin: SupabaseClient,
  regularSeasonId: number,
  draftPods: DraftPod[],
  opts: { startDate?: string | null } = {},
): Promise<SaveDraftResult> {
  const integrity = validateIntegrity(draftPods);
  if (!integrity.valid) return { status: 'invalid', errors: integrity.errors };

  const regularSeason = await getSeason(regularSeasonId);
  if (!regularSeason || regularSeason.is_gauntlet) {
    return { status: 'not-eligible', reason: 'Regular season not found' };
  }

  const existingGauntlet = await getLinkedGauntlet(regularSeason.name);
  let gauntletSeasonId: number;
  if (existingGauntlet) {
    gauntletSeasonId = existingGauntlet.id;
  } else {
    const created = await createGauntletSeasonRow(supabaseAdmin, regularSeason, opts);
    // 'already-exists' can't actually happen here — `getLinkedGauntlet()` just returned nothing —
    // but `createGauntletSeasonRow()`'s return type is shared with the auto-build path, which does
    // need it. Treat it as the same "reload and try again" defensive case as a stale materialized
    // pod below, rather than widening `SaveDraftResult` for an unreachable branch.
    if (created.status === 'already-exists') {
      return { status: 'invalid', errors: ['This season already has a gauntlet — reload and try again.'] };
    }
    if (created.status !== 'created') return created;
    gauntletSeasonId = created.gauntletSeasonId;
  }

  const currentPods = await getGauntletBracketShape(gauntletSeasonId);
  const currentById = new Map(currentPods.map((p) => [p.id, p]));
  const submittedIds = new Set(draftPods.map((p) => p.persistedId).filter((id): id is number => id != null));

  for (const current of currentPods) {
    if (current.materialized && !submittedIds.has(current.id)) {
      return { status: 'invalid', errors: ['A materialized pod is missing from this save — reload and try again.'] };
    }
  }

  const toDelete = currentPods.filter((p) => !p.materialized && !submittedIds.has(p.id)).map((p) => p.id);
  if (toDelete.length > 0) {
    const { error: slotsDelErr } = await supabaseAdmin.from('gauntlet_pod_slots').delete().in('pod_id', toDelete);
    if (slotsDelErr) throw slotsDelErr;
    const { error: podsDelErr } = await supabaseAdmin.from('gauntlet_pods').delete().in('id', toDelete);
    if (podsDelErr) throw podsDelErr;
  }

  const keyToId = new Map<string, number>();
  for (const pod of draftPods) {
    if (pod.persistedId != null) keyToId.set(pod.key, pod.persistedId);
  }

  const newPods = draftPods.filter((p) => p.persistedId == null);
  for (const pod of newPods) {
    const { data, error } = await supabaseAdmin
      .from('gauntlet_pods')
      .insert({
        season_id: gauntletSeasonId,
        round_number: pod.round_number,
        pod_index: pod.pod_index,
        advance_rule: pod.advance_rule,
        is_final: pod.is_final,
      })
      .select('id')
      .single();
    if (error) throw error;
    keyToId.set(pod.key, (data as { id: number }).id);
  }

  const updatedExisting = draftPods.filter((p) => {
    if (p.persistedId == null) return false;
    const current = currentById.get(p.persistedId);
    return !!current && !current.materialized;
  });
  for (const pod of updatedExisting) {
    const current = currentById.get(pod.persistedId!)!;
    if (current.advance_rule !== pod.advance_rule || current.is_final !== pod.is_final) {
      const { error } = await supabaseAdmin
        .from('gauntlet_pods')
        .update({ advance_rule: pod.advance_rule, is_final: pod.is_final })
        .eq('id', pod.persistedId!);
      if (error) throw error;
    }
  }

  // Not-yet-materialized pods have no matches depending on their slots yet, so a changed pod's
  // slots are simply replaced wholesale rather than diffed row-by-row.
  const podsNeedingSlotWrite = [...newPods, ...updatedExisting];
  if (podsNeedingSlotWrite.length > 0) {
    const rewrittenIds = updatedExisting.map((p) => p.persistedId!);
    if (rewrittenIds.length > 0) {
      const { error } = await supabaseAdmin.from('gauntlet_pod_slots').delete().in('pod_id', rewrittenIds);
      if (error) throw error;
    }
    const rows = podsNeedingSlotWrite.flatMap((pod) => {
      const podId = keyToId.get(pod.key)!;
      return pod.slots.map((slot, slot_index) => {
        if (slot.kind === 'player') {
          return {
            pod_id: podId,
            slot_index,
            source_kind: 'seed',
            source_seed: null,
            source_pod_id: null,
            player_id: slot.playerId,
          };
        }
        if (slot.kind === 'advance') {
          return {
            pod_id: podId,
            slot_index,
            source_kind: 'pod',
            source_seed: null,
            source_pod_id: keyToId.get(slot.sourcePodKey) ?? null,
            player_id: null,
          };
        }
        return { pod_id: podId, slot_index, source_kind: 'seed', source_seed: null, source_pod_id: null, player_id: null };
      });
    });
    const { error } = await supabaseAdmin.from('gauntlet_pod_slots').insert(rows);
    if (error) throw error;
  }

  // Round order matters here in principle (an earlier round's pod should materialize before a
  // later one references it), though in practice each pod's readiness only depends on its own 4
  // slots' already-persisted `player_id` state, not on materialization order within this save.
  const touched = podsNeedingSlotWrite
    .map((pod) => ({ id: keyToId.get(pod.key)!, round_number: pod.round_number }))
    .sort((a, b) => a.round_number - b.round_number);
  for (const { id } of touched) {
    await materializeIfReady(supabaseAdmin, id);
  }

  return { status: 'saved', gauntletSeasonId };
}

export type SeedBandNames = { byes: string[]; playing: string[]; relegated: string[] };

export type SeedResult =
  | { status: 'seeded'; bands: SeedBandNames }
  | { status: 'no-shape' }
  | { status: 'already-seeded' }
  | { status: 'drift'; shapeSeedCount: number; currentCount: number };

/** Seeds an already-built (but unseeded) gauntlet bracket from the regular season's *current*
 * leaderboard order and materializes round 1. Shared by the admin seed route and
 * `checkSeasonCompletion()`'s auto-seed — both just need to interpret the result differently. */
export async function trySeedGauntlet(supabaseAdmin: SupabaseClient, regularSeasonId: number): Promise<SeedResult> {
  const regularSeason = await getSeason(regularSeasonId);
  if (!regularSeason || regularSeason.is_gauntlet) return { status: 'no-shape' };

  const gauntletSeason = await getLinkedGauntlet(regularSeason.name);
  if (!gauntletSeason) return { status: 'no-shape' };

  const existingRounds = await getGauntletRounds(gauntletSeason.id);
  if (existingRounds.length > 0) return { status: 'already-seeded' };

  const leaderboard = await getSeasonLeaderboard(regularSeasonId);
  const N = leaderboard.length;

  // round1.length + byes.length reflects the shape's *actual* persisted seed count regardless of
  // what N we pass in here — it's the right value to diff against the current roster size.
  const bands = await getSeedBands(supabaseAdmin, gauntletSeason.id, N);
  const shapeSeedCount = bands.round1.length + bands.byes.length;
  if (shapeSeedCount === 0) return { status: 'no-shape' };
  if (shapeSeedCount !== N) return { status: 'drift', shapeSeedCount, currentCount: N };

  const playerBySeed = new Map<number, number>();
  leaderboard.forEach((row, i) => playerBySeed.set(i + 1, row.player_id));
  await seedBracket(supabaseAdmin, gauntletSeason.id, playerBySeed);

  const nameBySeed = new Map(leaderboard.map((row, i) => [i + 1, row.player_name]));
  const toNames = (seeds: number[]) => seeds.map((seed) => nameBySeed.get(seed)!);

  await clearOpsError(supabaseAdmin, 'season', regularSeasonId, 'gauntlet_seed');

  return {
    status: 'seeded',
    bands: { byes: toNames(bands.byes), playing: toNames(bands.round1), relegated: toNames(bands.dropped) },
  };
}
