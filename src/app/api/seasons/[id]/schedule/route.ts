import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/admin-access';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSeason, getSeasonRoster, getSeasonScheduleDraft } from '@/lib/queries';
import {
  generateSeasonScheduleDraft,
  deleteSeasonScheduleDraft,
  saveSeasonScheduleDraft,
  ScheduleDraftLockedError,
} from '@/lib/season-schedule-draft-engine';
import { MIN_SEED_COUNT, MAX_SEED_COUNT, type DoubleheaderPolicy } from '@/lib/season-schedule';
import type { DraftScheduleWeek } from '@/lib/season-schedule-validation';

const supabaseAdmin = getAdminClient();

/** Maps ScheduleDraftLockedError (another generate/save/delete already in flight for this season) to
 * 409, and everything else to 500. */
function mapScheduleDraftError(err: unknown): NextResponse {
  if (err instanceof ScheduleDraftLockedError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  return NextResponse.json({ error: (err as Error).message }, { status: 500 });
}

/**
 * Generates (or fully regenerates) a regular season's matchup draft from its current roster
 * (`season_players`) — `buildRosterSchedule()`'s output persisted into
 * `season_schedule_draft_weeks`/`_matches`. Admin-only, and only while the season is `UPCOMING`,
 * matching the window `SeasonRosterPanel` keeps the roster editable in — the draft is meant to be
 * generated once the roster is settled, then hand-edited, then confirmed (confirmation isn't built
 * yet). Always a full regenerate; there's no partial/reset-remaining mode yet since that depends on
 * confirm/materialize existing first.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminAccess();
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) {
    return NextResponse.json({ error: 'Invalid season ID' }, { status: 400 });
  }

  // Independent reads — none depends on another's result, so they run concurrently rather than
  // paying three sequential round trips.
  const [season, roster, body] = await Promise.all([
    getSeason(seasonId),
    getSeasonRoster(seasonId),
    req.json().catch(() => ({})),
  ]);

  if (!season || season.is_gauntlet) {
    return NextResponse.json({ error: 'Regular season not found' }, { status: 404 });
  }
  if (season.status !== 'UPCOMING') {
    return NextResponse.json({ error: 'Season must be UPCOMING to generate its matchup draft' }, { status: 400 });
  }

  const requestedPolicy = (body as { doubleheaderPolicy?: unknown })?.doubleheaderPolicy;
  if (requestedPolicy !== undefined && requestedPolicy !== 'auto' && requestedPolicy !== 'never') {
    return NextResponse.json({ error: "doubleheaderPolicy must be 'auto' or 'never'" }, { status: 400 });
  }
  const doubleheaderPolicy: DoubleheaderPolicy = requestedPolicy === 'never' ? 'never' : 'auto';
  const playerIds = roster.map((r) => r.player_id);

  if (playerIds.length < MIN_SEED_COUNT || playerIds.length > MAX_SEED_COUNT) {
    return NextResponse.json(
      { error: `This season's roster has ${playerIds.length} players — matchup generation supports ${MIN_SEED_COUNT}-${MAX_SEED_COUNT}` },
      { status: 400 },
    );
  }

  try {
    await generateSeasonScheduleDraft(supabaseAdmin, seasonId, playerIds, { doubleheaderPolicy });
  } catch (err) {
    return mapScheduleDraftError(err);
  }

  const draft = await getSeasonScheduleDraft(seasonId);
  return NextResponse.json({ draft }, { status: 201 });
}

/** Shallow structural check on a PATCH body's `weeks` — just enough to reject garbage with a clean
 * 400 instead of a raw crash inside validation/save; doesn't check for missing/extra weeks or
 * matches (saveSeasonScheduleDraft() itself throws on those, since they'd mean the editor sent a
 * structure generation never created). */
function isPlausibleDraftWeeks(value: unknown): value is DraftScheduleWeek[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (w) =>
      typeof w === 'object' &&
      w !== null &&
      typeof (w as DraftScheduleWeek).week_number === 'number' &&
      ((w as DraftScheduleWeek).bye_player_id === null || typeof (w as DraftScheduleWeek).bye_player_id === 'number') &&
      Array.isArray((w as DraftScheduleWeek).matches) &&
      (w as DraftScheduleWeek).matches.every(
        (m) =>
          typeof m === 'object' &&
          m !== null &&
          typeof m.match_number === 'number' &&
          Array.isArray(m.shirts) &&
          m.shirts.length === 2 &&
          m.shirts.every((id) => typeof id === 'number') &&
          Array.isArray(m.skins) &&
          m.skins.length === 2 &&
          m.skins.every((id) => typeof id === 'number'),
      ),
  );
}

/**
 * Saves a hand-edit to a season's matchup draft — reassigns players within the existing generated
 * week/match structure via `saveSeasonScheduleDraft()`. Admin-only, only while the season is
 * `UPCOMING`. Refuses with 400 (and the specific issues) if the edit fails
 * `validateDraftIntegrity()` — nothing is written in that case, so a rejected save can just be
 * retried after fixing the flagged slots.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminAccess();
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) {
    return NextResponse.json({ error: 'Invalid season ID' }, { status: 400 });
  }

  const [season, body] = await Promise.all([getSeason(seasonId), req.json().catch(() => null)]);
  if (!season || season.is_gauntlet) {
    return NextResponse.json({ error: 'Regular season not found' }, { status: 404 });
  }
  if (season.status !== 'UPCOMING') {
    return NextResponse.json({ error: 'Season must be UPCOMING to edit its matchup draft' }, { status: 400 });
  }

  const weeks = (body as { weeks?: unknown } | null)?.weeks;
  if (!isPlausibleDraftWeeks(weeks)) {
    return NextResponse.json({ error: 'weeks must be an array of draft weeks' }, { status: 400 });
  }

  let result;
  try {
    result = await saveSeasonScheduleDraft(supabaseAdmin, seasonId, weeks);
  } catch (err) {
    return mapScheduleDraftError(err);
  }

  if (!result.ok) {
    return NextResponse.json({ error: 'Draft has integrity issues', issues: result.issues }, { status: 400 });
  }

  const draft = await getSeasonScheduleDraft(seasonId);
  return NextResponse.json({ draft });
}

/** Clears a season's matchup draft with no side effects — nothing is materialized by generation,
 * so there's nothing to protect against here (unlike the gauntlet DELETE route's played-match
 * check). */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminAccess();
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) {
    return NextResponse.json({ error: 'Invalid season ID' }, { status: 400 });
  }

  const season = await getSeason(seasonId);
  if (!season || season.is_gauntlet) {
    return NextResponse.json({ error: 'Regular season not found' }, { status: 404 });
  }

  try {
    await deleteSeasonScheduleDraft(supabaseAdmin, seasonId);
  } catch (err) {
    return mapScheduleDraftError(err);
  }
  return NextResponse.json({ ok: true });
}
