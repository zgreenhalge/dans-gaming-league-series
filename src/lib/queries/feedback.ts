// Post-season survey and superlatives vote reads. Results queries aggregate by question or
// superlative and never return which player gave an answer or cast a vote. The responder/voter id
// columns exist to enforce one submission per player and to prefill that same player's own editor
// (`getPlayerSurveyAnswers()`, `getPlayerSuperlativeVotes()`); the survey results never select them,
// and the vote tally selects the voter id only to count distinct voters, never returning it.

import { supabase } from '../supabase';
import {
  summarizeSurvey,
  tallyVotes,
  type SurveyAnswers,
  type SurveyQuestion,
  type SurveyQuestionSummary,
} from '../survey';
import { getPlayersById } from './player';
import { getSeasonPlayedPlayers } from './seasons';
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

/** A season's survey with its questions in display order, or null if none has been sent. */
export async function getSurveyForSeason(seasonId: number): Promise<Survey | null> {
  const { data, error } = await supabase
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
  const { data, error } = await supabase
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
  responseCount: number;
  eligibleCount: number;
  summaries: SurveyQuestionSummary[];
}

/** Anonymised results for a season's survey, or null if none has been sent. */
export async function getSurveyResults(seasonId: number): Promise<SurveyResults | null> {
  const survey = await getSurveyForSeason(seasonId);
  if (!survey) return null;

  // Selects the `answers` column only — never `player_id`.
  const [{ data: responses, error }, eligible] = await Promise.all([
    supabase.from('survey_responses').select('answers').eq('survey_id', survey.id),
    getSeasonPlayedPlayers(seasonId),
  ]);
  if (error) throw error;

  const answers = (responses ?? []).map((r) => r.answers as SurveyAnswers);
  return {
    survey,
    isOpen: isSurveyOpen(survey),
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
    supabase.from('superlative_polls').select('is_open').eq('season_id', seasonId).maybeSingle(),
    supabase
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

/** One player's own ballot over the given superlatives, keyed by superlative id → nominee player id —
 *  for prefilling their editor. */
export async function getPlayerSuperlativeVotes(superlativeIds: number[], playerId: number): Promise<Record<number, number>> {
  if (superlativeIds.length === 0) return {};
  const { data: votes, error } = await supabase
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

/** What the season page's Survey and Superlatives tabs show a given viewer. */
export interface SeasonFeedbackView {
  /** Present while the survey is open and the viewer played the season. */
  survey: { questions: SurveyQuestion[]; answers: SurveyAnswers; responded: boolean } | null;
  /** A ballot while voting is open and the viewer played the season; the public tallies once voting
   *  has closed with at least one vote cast; otherwise absent. */
  superlatives:
    | { mode: 'ballot'; superlatives: Superlative[]; nominees: { id: number; name: string }[]; votes: Record<number, number> }
    | { mode: 'results'; results: SuperlativeResults }
    | null;
}

/** Resolves both feedback tabs for one viewer (`playerId` null = signed out). Cheap open-state reads
 *  run first so a season with nothing open never pays for the eligibility lookup, and a season with
 *  nothing configured costs two small queries. A closed vote's public tally needs no eligibility
 *  lookup and is independent of the survey, so it resolves for every viewer whatever else is open. */
export async function getSeasonFeedbackView(seasonId: number, playerId: number | null): Promise<SeasonFeedbackView> {
  const [survey, poll] = await Promise.all([getSurveyForSeason(seasonId), getSuperlativePoll(seasonId)]);
  const surveyOpen = survey && isSurveyOpen(survey) ? survey : null;
  const ballotOpen = poll?.isOpen && poll.superlatives.length > 0 ? poll : null;

  const view: SeasonFeedbackView = { survey: null, superlatives: null };

  if ((surveyOpen || ballotOpen) && playerId != null) {
    const eligible = await getSeasonPlayedPlayers(seasonId);
    if (eligible.some((p) => p.player_id === playerId)) {
      const [mine, votes] = await Promise.all([
        surveyOpen ? getPlayerSurveyAnswers(surveyOpen.id, playerId) : null,
        ballotOpen ? getPlayerSuperlativeVotes(ballotOpen.superlatives.map((s) => s.id), playerId) : null,
      ]);
      if (surveyOpen && mine) view.survey = { questions: surveyOpen.questions, ...mine };
      if (ballotOpen && votes) {
        view.superlatives = {
          mode: 'ballot',
          superlatives: ballotOpen.superlatives,
          nominees: eligible.map((p) => ({ id: p.player_id, name: p.player_name })),
          votes,
        };
      }
    }
  }

  if (!ballotOpen && poll && poll.superlatives.length > 0) {
    const results = await tallyPoll(poll);
    if (results.superlatives.some((s) => s.totalVotes > 0)) view.superlatives = { mode: 'results', results };
  }
  return view;
}
