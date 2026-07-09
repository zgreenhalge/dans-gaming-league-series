/**
 * Regular-season status transitions and their gauntlet side effects. `seasons.status` has no
 * automatic transitions anywhere else in the app — UPCOMING -> ACTIVE is an explicit admin action
 * (`activateSeason`), ACTIVE -> COMPLETED is automatic, detected from the score route once every
 * match in the season has been played (`checkSeasonCompletion`). Both side effects
 * (build/seed the linked gauntlet) are best-effort: a failure here never blocks the status
 * transition that triggered it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { isPlayedScore } from './util';
import { tryBuildGauntletShape, trySeedGauntlet } from './gauntlet-engine';

/** Transitions a regular season UPCOMING -> ACTIVE, then best-effort builds its gauntlet bracket
 * shape (sized from the roster at go-live time — see `tryBuildGauntletShape`). Throws only if the
 * status update itself fails; a shape-build failure is logged, not thrown. */
export async function activateSeason(supabaseAdmin: SupabaseClient, seasonId: number): Promise<void> {
  const { error } = await supabaseAdmin.from('seasons').update({ status: 'ACTIVE' }).eq('id', seasonId);
  if (error) throw error;

  try {
    await tryBuildGauntletShape(supabaseAdmin, seasonId);
  } catch (err) {
    console.error(`gauntlet auto-build(season ${seasonId}) failed:`, err);
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
    await trySeedGauntlet(supabaseAdmin, seasonId);
  } catch (err) {
    console.error(`gauntlet auto-seed(season ${seasonId}) failed:`, err);
  }
}
