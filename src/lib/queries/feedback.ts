// Post-season survey and superlatives vote reads. Results queries aggregate by question or
// superlative and never return which player gave an answer or cast a vote. The responder/voter id
// columns exist to enforce one submission per player and to prefill that same player's own editor
// (`getPlayerSurveyAnswers()`, `getPlayerSuperlativeVotes()`); the survey results never select them,
// and the vote tally selects the voter id only to count distinct voters, never returning it.

import { getAdminClient } from '../supabase-admin';
import {
  summarizeSurvey,
  tallyVotes,
  type SurveyAnswers,
  type SurveyQuestion,
  type SurveyQuestionSummary,
} from '../survey';
import { getPlayersById } from './player';
import { getSeasonPlayedPlayers, hasPlayedSeason } from './seasons';
import { batchedIn } from './_shared';

export interface Survey {
  id: number;
  season_id: number;
  closed_at: string | null;
  questions: SurveyQuestion[];
}

export function isSurveyOpen(survey: Survey): boolean {
  return survey.closed_at == null;
}

/** A season's survey with its questions in display order, or null if none has been created. */
export async function getSurveyForSeason(seasonId: number): Promise<Survey | null> {
  const { data, error } = await getAdminClient()
    .from('surveys')
    .select('id, season_id, closed_at, questions')
    .eq('season_id', seasonId)
    .maybeSingle();
  if (error) throw error;
  return data ? { ...data, questions: data.questions as unknown as SurveyQuestion[] } : null;
}

/** One player's own saved answers — for prefilling their editor — plus whether they have responded. */
export async function getPlayerSurveyAnswers(
  surveyId: number,
  playerId: number,
): Promise<{ responded: boolean; answers: SurveyAnswers }> {
  const { data, error } = await getAdminClient()
    .from('survey_responses')
    .select('answers')
    .eq('survey_id', surveyId)
    .eq('player_id', playerId)
    .maybeSingle();
  if (error) throw error;
  return data ? { responded: true, answers: data.answers as SurveyAnswers } : { responded: false, answers: {} };
}

export interface SurveyResults {
  survey: Survey;
  isOpen: boolean;
  /** The survey lock rule: open, or has any response — its questions are frozen, so no answer lands
   *  on a question list the player didn't see. `replace_survey_questions()` enforces the same rule
   *  on save. */
  isLocked: boolean;
  responseCount: number;
  eligibleCount: number;
  summaries: SurveyQuestionSummary[];
}

/** Anonymised results for a season's survey, or null if none has been created. */
export async function getSurveyResults(seasonId: number): Promise<SurveyResults | null> {
  const survey = await getSurveyForSeason(seasonId);
  if (!survey) return null;

  // Selects the `answers` column only — never `player_id`.
  const [{ data: responses, error }, eligible] = await Promise.all([
    getAdminClient().from('survey_responses').select('answers').eq('survey_id', survey.id),
    getSeasonPlayedPlayers(seasonId),
  ]);
  if (error) throw error;

  const answers = (responses ?? []).map((r) => r.answers as SurveyAnswers);
  return {
    survey,
    isOpen: isSurveyOpen(survey),
    isLocked: isSurveyOpen(survey) || answers.length > 0,
    responseCount: answers.length,
    eligibleCount: eligible.length,
    summaries: summarizeSurvey(survey.questions, answers),
  };
}

export interface Superlative {
  id: number;
  position: number;
  title: string;
}

export interface SuperlativePoll {
  isOpen: boolean;
  superlatives: Superlative[];
}

/** A season's superlatives and whether voting is open, or null if none have been set up. */
export async function getSuperlativePoll(seasonId: number): Promise<SuperlativePoll | null> {
  const [{ data: poll, error }, { data: superlatives, error: superlativesErr }] = await Promise.all([
    getAdminClient().from('superlative_polls').select('is_open').eq('season_id', seasonId).maybeSingle(),
    getAdminClient()
      .from('superlatives')
      .select('id, position, title')
      .eq('season_id', seasonId)
      .order('position', { ascending: true }),
  ]);
  if (error) throw error;
  if (superlativesErr) throw superlativesErr;
  if (!poll) return null;
  return { isOpen: poll.is_open, superlatives: superlatives ?? [] };
}

/** Whether a season has a superlatives poll — a cheaper check than `getSuperlativePoll()` when the
 *  superlatives themselves aren't needed. */
export async function hasSuperlativePoll(seasonId: number): Promise<boolean> {
  const { data, error } = await getAdminClient()
    .from('superlative_polls')
    .select('season_id')
    .eq('season_id', seasonId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/** True once players can or did vote: voting is open, or any vote exists. The superlatives list is
 *  frozen from then on, so no vote ever lands on a title or list the voter didn't see. */
export async function isSuperlativePollLocked(poll: SuperlativePoll): Promise<boolean> {
  if (poll.isOpen) return true;
  if (poll.superlatives.length === 0) return false;
  const { data, error } = await getAdminClient()
    .from('superlative_votes')
    .select('id')
    .in('superlative_id', poll.superlatives.map((s) => s.id))
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** One player's own ballot over the given superlatives, keyed by superlative id → nominee player id —
 *  for prefilling their editor. */
export async function getPlayerSuperlativeVotes(superlativeIds: number[], playerId: number): Promise<Record<number, number>> {
  if (superlativeIds.length === 0) return {};
  const { data: votes, error } = await getAdminClient()
    .from('superlative_votes')
    .select('superlative_id, nominee_player_id')
    .eq('voter_player_id', playerId)
    .in('superlative_id', superlativeIds);
  if (error) throw error;
  return Object.fromEntries((votes ?? []).map((v) => [v.superlative_id, v.nominee_player_id]));
}

export interface SuperlativeResult extends Superlative {
  totalVotes: number;
  nominees: { player_id: number; player_name: string; votes: number }[];
}

export interface SuperlativeResults {
  isOpen: boolean;
  /** Distinct players who cast at least one vote. */
  voterCount: number;
  superlatives: SuperlativeResult[];
}

/** The admin view adds how many players were eligible to vote. */
export interface SuperlativeAdminResults extends SuperlativeResults {
  eligibleCount: number;
}

async function tallyPoll(poll: SuperlativePoll): Promise<SuperlativeResults> {
  const [votes, playersById] = await Promise.all([
    batchedIn<{ superlative_id: number; voter_player_id: number; nominee_player_id: number }>(
      'superlative_votes',
      'superlative_id',
      poll.superlatives.map((s) => s.id),
      'superlative_id, voter_player_id, nominee_player_id',
    ),
    getPlayersById(),
  ]);

  return {
    isOpen: poll.isOpen,
    voterCount: new Set(votes.map((v) => v.voter_player_id)).size,
    superlatives: poll.superlatives.map((s) => {
      const nominees = tallyVotes(votes.filter((v) => v.superlative_id === s.id).map((v) => v.nominee_player_id)).map(
        (t) => ({ player_id: t.player_id, player_name: playersById.get(t.player_id)?.name ?? `Player ${t.player_id}`, votes: t.votes }),
      );
      return { ...s, totalVotes: nominees.reduce((sum, n) => sum + n.votes, 0), nominees };
    }),
  };
}

/** Anonymised vote tallies per superlative plus the eligible-voter count, or null if none have been
 *  set up. */
export async function getSuperlativeResults(seasonId: number): Promise<SuperlativeAdminResults | null> {
  const poll = await getSuperlativePoll(seasonId);
  if (!poll) return null;
  const [results, eligible] = await Promise.all([tallyPoll(poll), getSeasonPlayedPlayers(seasonId)]);
  return { ...results, eligibleCount: eligible.length };
}

/** Ids of seasons whose survey or superlatives vote is currently open for responses — a cheap
 *  pre-filter so callers only resolve per-viewer views for seasons that can have a banner. */
export async function getOpenFeedbackSeasonIds(): Promise<number[]> {
  const [{ data: surveys, error: surveyErr }, { data: polls, error: pollErr }] = await Promise.all([
    getAdminClient().from('surveys').select('season_id').is('closed_at', null),
    getAdminClient().from('superlative_polls').select('season_id').eq('is_open', true),
  ]);
  if (surveyErr) throw surveyErr;
  if (pollErr) throw pollErr;
  return [...new Set([...(surveys ?? []), ...(polls ?? [])].map((r) => r.season_id))];
}

/** What the season page's Survey tab shows a viewer: their form, while the survey is open and they
 *  played the season. Null (no tab) otherwise — for a signed-out or ineligible viewer, a closed
 *  survey, or a season with none. Independent of the superlatives vote. */
export interface SurveyTabView {
  questions: SurveyQuestion[];
  answers: SurveyAnswers;
  responded: boolean;
}

export async function getSeasonSurveyView(seasonId: number, playerId: number | null): Promise<SurveyTabView | null> {
  const survey = await getSurveyForSeason(seasonId);
  if (!survey || !isSurveyOpen(survey) || playerId == null) return null;
  const [played, mine] = await Promise.all([getSeasonPlayedPlayers(seasonId), getPlayerSurveyAnswers(survey.id, playerId)]);
  return hasPlayedSeason(played, playerId) ? { questions: survey.questions, ...mine } : null;
}

/** What the season page's Superlatives tab shows a viewer: a ballot while voting is open and they
 *  played the season; the public tallies once voting has closed with at least one vote cast; null (no
 *  tab) otherwise — including a vote that was set up but never opened. Independent of the survey. */
export type SuperlativesTabView =
  | { mode: 'ballot'; superlatives: Superlative[]; nominees: { id: number; name: string }[]; votes: Record<number, number> }
  | { mode: 'results'; results: SuperlativeResults };

export async function getSeasonSuperlativesView(seasonId: number, playerId: number | null): Promise<SuperlativesTabView | null> {
  const poll = await getSuperlativePoll(seasonId);
  if (!poll || poll.superlatives.length === 0) return null;

  if (!poll.isOpen) {
    const results = await tallyPoll(poll);
    return results.superlatives.some((s) => s.totalVotes > 0) ? { mode: 'results', results } : null;
  }

  if (playerId == null) return null;
  const [played, votes] = await Promise.all([
    getSeasonPlayedPlayers(seasonId),
    getPlayerSuperlativeVotes(poll.superlatives.map((s) => s.id), playerId),
  ]);
  if (!hasPlayedSeason(played, playerId)) return null;
  return {
    mode: 'ballot',
    superlatives: poll.superlatives,
    nominees: played.map((p) => ({ id: p.player_id, name: p.player_name })),
    votes,
  };
}
