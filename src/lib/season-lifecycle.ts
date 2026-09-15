/**
 * Season status transitions and their gauntlet side effects, for both regular and gauntlet season
 * rows. UPCOMING -> ACTIVE (`activateSeason`) fires automatically the moment a season's schedule is
 * confirmed (`POST /api/seasons/[id]/schedule/confirm`, via `activateSeasonBestEffort`) — confirming
 * is already the point of no return for the roster/schedule, so there's nothing left for a separate
 * manual step to gate. `MarkSeasonActiveButton` stays on the season page as a manual fallback for the
 * rare case where the auto-trigger's own status write fails; every other transition is automatic,
 * detected from the score route:
 *   - A regular season goes ACTIVE -> ARCHIVED once every match in it has been played
 *     (`checkSeasonCompletion`), which also best-effort seeds its linked gauntlet.
 *   - A gauntlet season goes -> ARCHIVED once every match in it has been played *and* its Final pod
 *     is specifically decided (`checkGauntletCompletion`), which also archives its paired regular
 *     season if that hasn't happened yet (a manually-built gauntlet can still be going after its
 *     regular season already archived).
 * All side effects are best-effort: a failure here never blocks the status transition that
 * triggered it. Every failure (or roster-drift outcome that needs admin attention) is recorded via
 * `recordOpsError()` (`src/lib/ops-errors.ts`, entity type `season`, operation
 * `season_complete`/`gauntlet_build`/`gauntlet_seed`/`gauntlet_archive`/`discord_role_sync`) —
 * cleared automatically the next time that same operation succeeds, whether that's another
 * auto-trigger or a manual retry from the admin UI (`tryBuildGauntletShape` and `trySeedGauntlet`
 * clear it themselves on success; `checkGauntletCompletion` clears `gauntlet_archive` on success;
 * `deleteGauntletSeason` clears `gauntlet_build`/`gauntlet_seed` on reset).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { tryBuildGauntletShape, trySeedGauntlet, isGauntletBracketDecided } from './gauntlet-engine';
import { getLinkedRegularSeason, getSeasonParticipants, isSeasonFullyPlayed } from './queries';
import { recordOpsError, clearOpsError } from './ops-errors';
import { grantParticipantRoleToRoster, revokeParticipantRoleFromRoster, type RosterRoleEntry } from './discord-roles';

export interface ActivateSeasonResult {
  gauntletBuilt: boolean;
  /** Why the gauntlet wasn't built, when `gauntletBuilt` is false — surfaced by the PATCH route so
   * the admin sees it in the UI at the moment of the click, not just in server logs. */
  gauntletBuildError: string | null;
}

/** Shared shape behind the `@Participants` grant/revoke passes in `activateSeason()` and
 * `checkSeasonCompletion()` below — fetch the roster, hand it to whichever roster-wide sync
 * function the caller needs, and record (never throw) if the roster fetch itself fails. `sync`
 * (grant/revoke to the roster) never throws on its own — each per-player Discord API failure inside
 * it is already recorded to `ops_errors` at the player level (`discord-roles.ts`) — so the only
 * failure this can catch is `getSeasonParticipants()` itself, surfaced here at the season level so a
 * transient DB hiccup on this best-effort step is visible in the admin console instead of only a
 * Vercel function log, without ever blocking the season transition it rides along with. */
async function syncParticipantRoleForRoster(
  supabaseAdmin: SupabaseClient,
  seasonId: number,
  label: string,
  sync: (supabaseAdmin: SupabaseClient, roster: RosterRoleEntry[]) => Promise<void>,
): Promise<void> {
  try {
    const roster = await getSeasonParticipants(seasonId);
    await sync(supabaseAdmin, roster);
    await clearOpsError(supabaseAdmin, 'season', seasonId, 'discord_role_sync');
  } catch (err) {
    console.error(`@Participants ${label}(season ${seasonId}) failed:`, err);
    await recordOpsError(supabaseAdmin, 'season', seasonId, 'discord_role_sync', `@Participants ${label} failed: ${(err as Error).message}`);
  }
}

/** Best-effort gauntlet-shape build behind `activateSeason()` — never throws; a build failure is
 * reported in the returned `ActivateSeasonResult` (and recorded as an `ops_error`) instead. */
async function buildGauntletShapeBestEffort(supabaseAdmin: SupabaseClient, seasonId: number): Promise<ActivateSeasonResult> {
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

/** Transitions a regular season UPCOMING -> ACTIVE, then best-effort builds its gauntlet bracket
 * shape (sized from the roster at go-live time — see `tryBuildGauntletShape`) and grants
 * `@Participants` to the whole roster (a catch-up pass covering anyone whose individual
 * add-to-roster grant, `POST /api/seasons/[id]/players`, was a no-op because they linked Discord
 * after joining). The two run concurrently — neither depends on the other's result, and both are
 * independently best-effort (never reject `Promise.all`). Throws only if the status update itself
 * fails; a shape-build failure is reported in the return value (and recorded as an `ops_error`), not
 * thrown — activation still succeeds either way. */
export async function activateSeason(supabaseAdmin: SupabaseClient, seasonId: number): Promise<ActivateSeasonResult> {
  const { error } = await supabaseAdmin.from('seasons').update({ status: 'ACTIVE' }).eq('id', seasonId);
  if (error) throw error;

  const [, result] = await Promise.all([
    syncParticipantRoleForRoster(supabaseAdmin, seasonId, 'catch-up grant', grantParticipantRoleToRoster),
    buildGauntletShapeBestEffort(supabaseAdmin, seasonId),
  ]);
  return result;
}

/** Best-effort wrapper around `activateSeason()` for the schedule-confirm auto-trigger
 * (`POST /api/seasons/[id]/schedule/confirm`) — confirming a season's schedule is real, committed
 * data (weeks/matches now exist) regardless of whether the subsequent ACTIVE flip lands, so a
 * failure here must never fail the confirm response itself. Recorded to `ops_errors`
 * (`season_activate`) rather than thrown; `MarkSeasonActiveButton` stays on the season page as the
 * manual retry path for exactly this case. */
export async function activateSeasonBestEffort(supabaseAdmin: SupabaseClient, seasonId: number): Promise<void> {
  try {
    await activateSeason(supabaseAdmin, seasonId);
    await clearOpsError(supabaseAdmin, 'season', seasonId, 'season_activate');
  } catch (err) {
    console.error(`auto-activate(season ${seasonId}) after schedule confirm failed:`, err);
    await recordOpsError(
      supabaseAdmin, 'season', seasonId, 'season_activate',
      `Auto-activate after schedule confirm failed: ${(err as Error).message}. Use "Mark Active" to retry.`,
    );
  }
}

/** Best-effort gauntlet-seed behind `checkSeasonCompletion()` — never throws; a roster-drift skip
 * or a real failure is recorded as an `ops_error` instead. */
async function seedGauntletBestEffort(supabaseAdmin: SupabaseClient, seasonId: number): Promise<void> {
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

/** Called from the score route's post-commit hook for every regular-season match. If this score
 * completed the season (every match now played) and the season is still ACTIVE, marks it
 * ARCHIVED, then concurrently best-effort seeds its linked gauntlet from final standings and
 * revokes `@Participants` from the whole roster (the season's over, so it's no longer "current") —
 * neither depends on the other's result. No-op for gauntlet matches, seasons not currently ACTIVE,
 * or seasons with matches still outstanding. */
export async function checkSeasonCompletion(supabaseAdmin: SupabaseClient, seasonId: number): Promise<void> {
  const { data: seasonRow, error: seasonErr } = await supabaseAdmin
    .from('seasons')
    .select('status, is_gauntlet')
    .eq('id', seasonId)
    .maybeSingle();
  if (seasonErr) throw seasonErr;
  const season = seasonRow as { status: string; is_gauntlet: boolean } | null;
  if (!season || season.is_gauntlet || season.status !== 'ACTIVE') return;

  if (!(await isSeasonFullyPlayed(seasonId, supabaseAdmin))) return;

  const { error: updErr } = await supabaseAdmin.from('seasons').update({ status: 'ARCHIVED' }).eq('id', seasonId);
  if (updErr) {
    await recordOpsError(supabaseAdmin, 'season', seasonId, 'season_complete', `Marking season ARCHIVED failed: ${updErr.message}`);
    throw updErr;
  }

  await Promise.all([
    syncParticipantRoleForRoster(supabaseAdmin, seasonId, 'revoke', revokeParticipantRoleFromRoster),
    seedGauntletBestEffort(supabaseAdmin, seasonId),
  ]);
}

/** Called from the score route's post-commit hook for every gauntlet match. Once every match in
 * the gauntlet has been played *and* its actual Final pod has been decided, archives the gauntlet
 * season and, if a paired regular season exists, archives it too, regardless of its current status.
 * Both conditions matter, not just one: `isSeasonFullyPlayed()` alone (shared with
 * `checkSeasonCompletion()`) is correct for an automated (pod-based) bracket, whose Final
 * structurally can't materialize until every earlier pod has resolved — but a manually-built
 * gauntlet (see gauntlet-engine.ts's `saveManualDraft`) can have later rounds not designed yet at
 * all, so "every match that currently exists is played" can be true well before the bracket is
 * actually decided; `isGauntletBracketDecided()` (gauntlet-engine.ts) closes that gap by requiring
 * the Final pod specifically to exist and be played. Conversely the Final being decided doesn't
 * alone imply nothing else is outstanding (an earlier-round game unrelated to the Final's path could
 * still be unplayed), hence still checking both. Idempotent: no-ops once the gauntlet is already
 * ARCHIVED, or if either condition isn't met yet. */
export async function checkGauntletCompletion(supabaseAdmin: SupabaseClient, gauntletSeasonId: number): Promise<void> {
  const { data: seasonRow, error: seasonErr } = await supabaseAdmin
    .from('seasons')
    .select('name, status, is_gauntlet')
    .eq('id', gauntletSeasonId)
    .maybeSingle();
  if (seasonErr) throw seasonErr;
  const season = seasonRow as { name: string; status: string; is_gauntlet: boolean } | null;
  if (!season || !season.is_gauntlet) return;

  if (!(await isSeasonFullyPlayed(gauntletSeasonId, supabaseAdmin))) return;
  if (!(await isGauntletBracketDecided(supabaseAdmin, gauntletSeasonId))) return;

  // Checked separately from the gauntlet's own status so a run that archived the gauntlet but then
  // failed to archive its paired regular season retries just the outstanding half next time,
  // instead of short-circuiting on `season.status === 'ARCHIVED'` and stranding the partial state.
  const regularSeason = await getLinkedRegularSeason(season.name);
  const gauntletNeedsArchive = season.status !== 'ARCHIVED';
  const regularNeedsArchive = regularSeason != null && regularSeason.status !== 'ARCHIVED';
  if (!gauntletNeedsArchive && !regularNeedsArchive) return;

  try {
    if (gauntletNeedsArchive) {
      const { error: gauntletUpdErr } = await supabaseAdmin
        .from('seasons')
        .update({ status: 'ARCHIVED' })
        .eq('id', gauntletSeasonId);
      if (gauntletUpdErr) throw gauntletUpdErr;
    }
    if (regularNeedsArchive) {
      const { error: regUpdErr } = await supabaseAdmin.from('seasons').update({ status: 'ARCHIVED' }).eq('id', regularSeason!.id);
      if (regUpdErr) throw regUpdErr;
    }
    await clearOpsError(supabaseAdmin, 'season', gauntletSeasonId, 'gauntlet_archive');
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
