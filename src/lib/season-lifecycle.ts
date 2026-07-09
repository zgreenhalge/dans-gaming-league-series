/**
 * Season status transitions and their gauntlet side effects, for both regular and gauntlet season
 * rows. UPCOMING -> ACTIVE is an explicit admin action (`activateSeason`); every other transition
 * is automatic, detected from the score route:
 *   - ACTIVE -> COMPLETED once every match in a regular season has been played
 *     (`checkSeasonCompletion`), which also best-effort seeds its linked gauntlet.
 *   - -> ARCHIVED once every match in a gauntlet has been played (`checkGauntletCompletion`,
 *     sharing the same "fully played" check as `checkSeasonCompletion`) — archives the gauntlet
 *     *and* its paired regular season together, since a season isn't fully "in the books" until
 *     its playoffs conclude.
 * All side effects are best-effort: a failure here never blocks the status transition that
 * triggered it. Every failure (or roster-drift outcome that needs admin attention) is recorded via
 * `recordOpsError()` (`src/lib/ops-errors.ts`, entity type `season`, operation
 * `gauntlet_build`/`gauntlet_seed`/`gauntlet_archive`) — cleared automatically the next time that
 * same operation succeeds, whether that's another auto-trigger or a manual retry from the admin UI
 * (`tryBuildGauntletShape` and `trySeedGauntlet` clear it themselves on success;
 * `deleteGauntletSeason` clears it on reset).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { isPlayedScore } from './util';
import { tryBuildGauntletShape, trySeedGauntlet } from './gauntlet-engine';
import { getLinkedRegularSeason } from './queries';
import { recordOpsError } from './ops-errors';

export interface ActivateSeasonResult {
  gauntletBuilt: boolean;
  /** Why the gauntlet wasn't built, when `gauntletBuilt` is false — surfaced by the PATCH route so
   * the admin sees it in the UI at the moment of the click, not just in server logs. */
  gauntletBuildError: string | null;
}

/** Transitions a regular season UPCOMING -> ACTIVE, then best-effort builds its gauntlet bracket
 * shape (sized from the roster at go-live time — see `tryBuildGauntletShape`). Throws only if the
 * status update itself fails; a shape-build failure is reported in the return value (and recorded
 * as an `ops_error`), not thrown — activation still succeeds either way. */
export async function activateSeason(supabaseAdmin: SupabaseClient, seasonId: number): Promise<ActivateSeasonResult> {
  const { error } = await supabaseAdmin.from('seasons').update({ status: 'ACTIVE' }).eq('id', seasonId);
  if (error) throw error;

  try {
    const result = await tryBuildGauntletShape(supabaseAdmin, seasonId);
    if (result.status === 'built') {
      return { gauntletBuilt: true, gauntletBuildError: null };
    }
    const reason = result.status === 'not-eligible' ? result.reason : 'A gauntlet already exists for this season';
    await recordOpsError(supabaseAdmin, 'season', seasonId, 'gauntlet_build', `Gauntlet build failed: ${reason}`);
    return { gauntletBuilt: false, gauntletBuildError: reason };
  } catch (err) {
    console.error(`gauntlet auto-build(season ${seasonId}) failed:`, err);
    const message = (err as Error).message;
    await recordOpsError(supabaseAdmin, 'season', seasonId, 'gauntlet_build', `Gauntlet build failed: ${message}`);
    return { gauntletBuilt: false, gauntletBuildError: message };
  }
}

/** True if the season has a schedule (at least one week/match exists) and every match in it has a
 * played score. A season with no matches yet is never "fully played". */
async function isSeasonFullyPlayed(supabaseAdmin: SupabaseClient, seasonId: number): Promise<boolean> {
  const { data: weeks, error: weekErr } = await supabaseAdmin.from('weeks').select('id').eq('season_id', seasonId);
  if (weekErr) throw weekErr;
  const weekIds = ((weeks ?? []) as { id: number }[]).map((w) => w.id);
  if (weekIds.length === 0) return false;

  const { data: matches, error: matchErr } = await supabaseAdmin
    .from('matches')
    .select('final_score')
    .in('week_id', weekIds);
  if (matchErr) throw matchErr;
  const rows = (matches ?? []) as { final_score: string | null }[];
  if (rows.length === 0) return false;

  return rows.every((m) => isPlayedScore(m.final_score));
}

/** Called from the score route's post-commit hook for every regular-season match. If this score
 * completed the season (every match now played) and the season is still ACTIVE, marks it
 * COMPLETED and best-effort seeds its linked gauntlet from final standings. No-op for gauntlet
 * matches, seasons not currently ACTIVE, or seasons with matches still outstanding. */
export async function checkSeasonCompletion(supabaseAdmin: SupabaseClient, seasonId: number): Promise<void> {
  const { data: seasonRow, error: seasonErr } = await supabaseAdmin
    .from('seasons')
    .select('status, is_gauntlet')
    .eq('id', seasonId)
    .maybeSingle();
  if (seasonErr) throw seasonErr;
  const season = seasonRow as { status: string; is_gauntlet: boolean } | null;
  if (!season || season.is_gauntlet || season.status !== 'ACTIVE') return;

  if (!(await isSeasonFullyPlayed(supabaseAdmin, seasonId))) return;

  const { error: updErr } = await supabaseAdmin.from('seasons').update({ status: 'COMPLETED' }).eq('id', seasonId);
  if (updErr) throw updErr;

  try {
    const result = await trySeedGauntlet(supabaseAdmin, seasonId);
    if (result.status === 'drift') {
      await recordOpsError(
        supabaseAdmin,
        'season',
        seasonId,
        'gauntlet_seed',
        `Auto-seed skipped: roster drifted since the bracket was built (shape expects ${result.shapeSeedCount} qualifiers, season now has ${result.currentCount}). Reset and rebuild the bracket.`,
      );
    }
  } catch (err) {
    console.error(`gauntlet auto-seed(season ${seasonId}) failed:`, err);
    await recordOpsError(supabaseAdmin, 'season', seasonId, 'gauntlet_seed', `Auto-seed failed: ${(err as Error).message}`);
  }
}

/** Called from the score route's post-commit hook for every gauntlet match. Once every match in
 * the gauntlet has been played — not just the final round — archives the gauntlet season and, if a
 * paired regular season exists, archives it too, regardless of its current status. Shares
 * `isSeasonFullyPlayed()` with `checkSeasonCompletion()` rather than checking only the max
 * `round_number`'s matches: for an automated (pod-based) bracket the final round structurally can't
 * materialize until every earlier pod has resolved, so the two checks are equivalent there — but a
 * manually-built gauntlet (see gauntlet-engine.ts's `createManualGauntletMatch`) has no such
 * guarantee, since nothing stops an admin from adding a later round before an earlier one is
 * finished. Idempotent: no-ops once the gauntlet is already ARCHIVED, or if any match is still
 * unplayed. */
export async function checkGauntletCompletion(supabaseAdmin: SupabaseClient, gauntletSeasonId: number): Promise<void> {
  const { data: seasonRow, error: seasonErr } = await supabaseAdmin
    .from('seasons')
    .select('name, status, is_gauntlet')
    .eq('id', gauntletSeasonId)
    .maybeSingle();
  if (seasonErr) throw seasonErr;
  const season = seasonRow as { name: string; status: string; is_gauntlet: boolean } | null;
  if (!season || !season.is_gauntlet || season.status === 'ARCHIVED') return;

  if (!(await isSeasonFullyPlayed(supabaseAdmin, gauntletSeasonId))) return;

  try {
    const { error: gauntletUpdErr } = await supabaseAdmin
      .from('seasons')
      .update({ status: 'ARCHIVED' })
      .eq('id', gauntletSeasonId);
    if (gauntletUpdErr) throw gauntletUpdErr;

    const regularSeason = await getLinkedRegularSeason(season.name);
    if (regularSeason) {
      const { error: regUpdErr } = await supabaseAdmin.from('seasons').update({ status: 'ARCHIVED' }).eq('id', regularSeason.id);
      if (regUpdErr) throw regUpdErr;
    }
  } catch (err) {
    console.error(`gauntlet auto-archive(season ${gauntletSeasonId}) failed:`, err);
    await recordOpsError(
      supabaseAdmin,
      'season',
      gauntletSeasonId,
      'gauntlet_archive',
      `Auto-archive failed: ${(err as Error).message}`,
    );
  }
}
