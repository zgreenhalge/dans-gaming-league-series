// Route handlers shared by the survey and superlatives routes: admin open/close and reset, and a
// player's answer save. A route supplies a `FeedbackLifecycle` describing how its form is found,
// read and written, and each handler runs the identical sequence for both forms — look the form up
// (404 if the season has none), apply the change, map a failed write to a 500 — so a new lifecycle
// step is written once here plus one method per adapter. Callers have already passed
// `requireSeasonFeedbackAdmin()` / `requireSeasonFeedbackAccess()`.
//
// The adapters are also where the two forms' stored open state differs: a survey has
// `surveys.closed_at` (null = open), a superlatives vote `superlative_polls.is_open`. `isOpen()` and
// `setOpen()` hide that, `getOpenFeedbackSeasonIds()` (`queries/feedback.ts`) queries each shape, and
// the player-side save RPCs test the matching column in SQL.

import { NextResponse } from 'next/server';
import { getAdminClient } from './supabase-admin';
import { getSuperlativePoll, getSurveyForSeason, isSurveyOpen } from './queries';
import type { SuperlativePoll, Survey } from './queries';
import type { SeasonFeedbackPlayer } from './feedback-access';
import { validateSuperlativeVotes, validateSurveyAnswers } from './survey';
import type { Json } from './database.types';

type DbError = { message: string } | null;
/** The outcome of a lifecycle write: the database error, if any. */
type WriteResult = PromiseLike<{ error: DbError }>;

export interface FeedbackLifecycle<Form> {
  /** The 404 message when the season has no form. */
  missing: string;
  /** The 409 message for a save to a closed form. */
  closed: string;
  find(seasonId: number): Promise<Form | null>;
  isOpen(form: Form): boolean;
  /** A reason this form can't be opened yet (answered 400), or null. */
  cannotOpen?(form: Form): string | null;
  setOpen(seasonId: number, form: Form, open: boolean): WriteResult;
  /** Closes the form and deletes every answer, keeping its questions or superlatives. */
  reset(seasonId: number, form: Form): WriteResult;
  /** Validates a player's request body and, if valid, starts the RPC that replaces their answers —
   *  it resolves `true` when saved, `false` when the form had closed (the RPC is the authority on
   *  that, re-checking under a lock). */
  save(
    form: Form,
    player: SeasonFeedbackPlayer,
    body: unknown,
  ): { invalid: string } | { write: PromiseLike<{ data: boolean | null; error: DbError }> };
}

export const SURVEY_LIFECYCLE: FeedbackLifecycle<Survey> = {
  missing: 'This season has no survey',
  closed: 'This survey is closed',
  find: getSurveyForSeason,
  isOpen: isSurveyOpen,
  setOpen: (_seasonId, survey, open) =>
    getAdminClient().from('surveys').update({ closed_at: open ? null : new Date().toISOString() }).eq('id', survey.id),
  reset: (_seasonId, survey) => getAdminClient().rpc('reset_survey', { p_survey_id: survey.id }),
  save: (survey, player, body) => {
    const parsed = validateSurveyAnswers(survey.questions, (body as { answers?: unknown } | null)?.answers);
    if (!parsed.ok) return { invalid: parsed.error };
    return {
      write: getAdminClient().rpc('save_survey_response', {
        p_survey_id: survey.id,
        p_player_id: player.playerId,
        p_answers: parsed.value as Json,
      }),
    };
  },
};

export const SUPERLATIVES_LIFECYCLE: FeedbackLifecycle<SuperlativePoll> = {
  missing: 'No superlatives vote for this season',
  closed: 'Voting is closed',
  find: getSuperlativePoll,
  isOpen: (poll) => poll.isOpen,
  cannotOpen: (poll) => (poll.superlatives.length === 0 ? 'Add a superlative before opening the vote' : null),
  setOpen: (seasonId, _poll, open) =>
    getAdminClient().from('superlative_polls').update({ is_open: open }).eq('season_id', seasonId),
  reset: (seasonId) => getAdminClient().rpc('reset_superlative_votes', { p_season_id: seasonId }),
  save: (poll, player, body) => {
    const superlativeIds = poll.superlatives.map((s) => s.id);
    const parsed = validateSuperlativeVotes(
      superlativeIds,
      player.eligible.map((p) => p.player_id),
      (body as { votes?: unknown } | null)?.votes,
    );
    if (!parsed.ok) return { invalid: parsed.error };
    return {
      write: getAdminClient().rpc('replace_superlative_votes', {
        p_season_id: player.seasonId,
        p_voter_player_id: player.playerId,
        p_superlative_ids: superlativeIds,
        p_votes: parsed.value,
      }),
    };
  },
};

function failure(error: { message: string }) {
  return NextResponse.json({ error: error.message }, { status: 500 });
}

/** Opens or closes a season's form. Closing keeps every answer; players just can no longer submit or
 *  edit. Pass `known` when the route has already loaded the form. */
export async function setFeedbackOpen<Form>(
  lifecycle: FeedbackLifecycle<Form>,
  seasonId: number,
  open: boolean,
  known?: Form,
) {
  const form = known ?? (await lifecycle.find(seasonId));
  if (!form) return NextResponse.json({ error: lifecycle.missing }, { status: 404 });
  const blocked = open ? lifecycle.cannotOpen?.(form) : null;
  if (blocked) return NextResponse.json({ error: blocked }, { status: 400 });

  const { error } = await lifecycle.setOpen(seasonId, form, open);
  return error ? failure(error) : NextResponse.json({ ok: true });
}

/** Admin reset: closes a season's form and deletes every answer as one all-or-nothing RPC call. The
 *  questions or superlatives are kept and — with no answers and the form closed — editable again. */
export async function resetFeedback<Form>(lifecycle: FeedbackLifecycle<Form>, seasonId: number) {
  const form = await lifecycle.find(seasonId);
  if (!form) return NextResponse.json({ error: lifecycle.missing }, { status: 404 });

  const { error } = await lifecycle.reset(seasonId, form);
  return error ? failure(error) : NextResponse.json({ ok: true });
}

/** Saves the signed-in player's answers, replacing any they already saved — answers left out are
 *  cleared. The open check here gives a friendly early 409; the save RPC is the authority, re-checking
 *  under a lock so a close or reset landing in between still refuses the write. */
export async function saveFeedbackAnswers<Form>(
  lifecycle: FeedbackLifecycle<Form>,
  player: SeasonFeedbackPlayer,
  req: Request,
) {
  const form = await lifecycle.find(player.seasonId);
  if (!form) return NextResponse.json({ error: lifecycle.missing }, { status: 404 });
  if (!lifecycle.isOpen(form)) return NextResponse.json({ error: lifecycle.closed }, { status: 409 });

  const attempt = lifecycle.save(form, player, await req.json().catch(() => null));
  if ('invalid' in attempt) return NextResponse.json({ error: attempt.invalid }, { status: 400 });

  const { data: saved, error } = await attempt.write;
  if (error) return failure(error);
  return saved ? NextResponse.json({ ok: true }) : NextResponse.json({ error: lifecycle.closed }, { status: 409 });
}
