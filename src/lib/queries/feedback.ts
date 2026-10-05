// Post-season survey and superlatives vote reads. Results are anonymous by construction: the
// summarising queries never return which player gave an answer or cast a vote — the response/voter
// ids exist in the tables only to enforce one submission per player and to prefill that same
// player's own editor (`getPlayerSurveyAnswers()`, `getPlayerSuperlativeVotes()`).

import { supabase } from '../supabase';
import {
  summarizeSurvey,
  tallyVotes,
  type SurveyQuestionKind,
  type SurveyQuestionSummary,
} from '../survey';
import { getPlayersById } from './player';
import { getSeasonPlayedPlayers } from './seasons';
import { batchedIn } from './_shared';

export interface Survey {
  id: number;
  season_id: number;
  opened_at: string;
  closed_at: string | null;
}

export interface SurveyQuestion {
  id: number;
  position: number;
  kind: SurveyQuestionKind;
  prompt: string;
  is_core: boolean;
}

export interface SurveyWithQuestions {
  survey: Survey;
  questions: SurveyQuestion[];
}

export function isSurveyOpen(survey: Survey): boolean {
  return survey.closed_at == null;
}

/** A season's survey and its questions in display order, or null if none has been sent. */
export async function getSurveyForSeason(seasonId: number): Promise<SurveyWithQuestions | null> {
  const { data: survey, error } = await supabase
    .from('surveys')
    .select('id, season_id, opened_at, closed_at')
    .eq('season_id', seasonId)
    .maybeSingle();
  if (error) throw error;
  if (!survey) return null;

  const { data: questions, error: questionsErr } = await supabase
    .from('survey_questions')
    .select('id, position, kind, prompt, is_core')
    .eq('survey_id', survey.id)
    .order('position', { ascending: true });
  if (questionsErr) throw questionsErr;
  return { survey, questions: (questions ?? []) as SurveyQuestion[] };
}

/** One player's own saved answers, keyed by question id (`rating` → number, `yes_no` → boolean,
 *  `text` → string) — for prefilling their editor — plus whether they have responded at all. */
export async function getPlayerSurveyAnswers(
  surveyId: number,
  playerId: number,
): Promise<{ responded: boolean; answers: Record<number, number | boolean | string> }> {
  const { data: response, error } = await supabase
    .from('survey_responses')
    .select('id')
    .eq('survey_id', surveyId)
    .eq('player_id', playerId)
    .maybeSingle();
  if (error) throw error;
  if (!response) return { responded: false, answers: {} };

  const [{ data: answerRows, error: answersErr }, { data: questionRows, error: questionsErr }] = await Promise.all([
    supabase.from('survey_answers').select('question_id, answer_number, answer_text').eq('response_id', response.id),
    supabase.from('survey_questions').select('id, kind').eq('survey_id', surveyId),
  ]);
  if (answersErr) throw answersErr;
  if (questionsErr) throw questionsErr;

  const kindById = new Map((questionRows ?? []).map((q) => [q.id, q.kind as SurveyQuestionKind]));
  const answers: Record<number, number | boolean | string> = {};
  for (const a of answerRows ?? []) {
    const kind = kindById.get(a.question_id);
    if (kind === 'text') {
      if (a.answer_text != null) answers[a.question_id] = a.answer_text;
    } else if (a.answer_number != null) {
      answers[a.question_id] = kind === 'yes_no' ? a.answer_number === 1 : a.answer_number;
    }
  }
  return { responded: true, answers };
}

export interface SurveyResults extends SurveyWithQuestions {
  responseCount: number;
  eligibleCount: number;
  summaries: SurveyQuestionSummary[];
}

/** Anonymised results for a season's survey, or null if none has been sent. */
export async function getSurveyResults(seasonId: number): Promise<SurveyResults | null> {
  const found = await getSurveyForSeason(seasonId);
  if (!found) return null;

  const [{ data: responses, error }, answers, eligible] = await Promise.all([
    supabase.from('survey_responses').select('id').eq('survey_id', found.survey.id),
    batchedIn<{ question_id: number; answer_number: number | null; answer_text: string | null }>(
      'survey_answers',
      'question_id',
      found.questions.map((q) => q.id),
      'question_id, answer_number, answer_text',
    ),
    getSeasonPlayedPlayers(seasonId),
  ]);
  if (error) throw error;

  return {
    ...found,
    responseCount: (responses ?? []).length,
    eligibleCount: eligible.length,
    summaries: summarizeSurvey(found.questions, answers),
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

/** One player's own ballot, keyed by superlative id → nominee player id — for prefilling their editor. */
export async function getPlayerSuperlativeVotes(seasonId: number, playerId: number): Promise<Record<number, number>> {
  const { data: superlatives, error } = await supabase.from('superlatives').select('id').eq('season_id', seasonId);
  if (error) throw error;
  const ids = (superlatives ?? []).map((s) => s.id);
  if (ids.length === 0) return {};

  const { data: votes, error: votesErr } = await supabase
    .from('superlative_votes')
    .select('superlative_id, nominee_player_id')
    .eq('voter_player_id', playerId)
    .in('superlative_id', ids);
  if (votesErr) throw votesErr;
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
  eligibleCount: number;
  superlatives: SuperlativeResult[];
}

/** Anonymised vote tallies per superlative, or null if none have been set up. */
export async function getSuperlativeResults(seasonId: number): Promise<SuperlativeResults | null> {
  const poll = await getSuperlativePoll(seasonId);
  if (!poll) return null;

  const [votes, eligible, playersById] = await Promise.all([
    batchedIn<{ superlative_id: number; voter_player_id: number; nominee_player_id: number }>(
      'superlative_votes',
      'superlative_id',
      poll.superlatives.map((s) => s.id),
      'superlative_id, voter_player_id, nominee_player_id',
    ),
    getSeasonPlayedPlayers(seasonId),
    getPlayersById(),
  ]);

  return {
    isOpen: poll.isOpen,
    voterCount: new Set(votes.map((v) => v.voter_player_id)).size,
    eligibleCount: eligible.length,
    superlatives: poll.superlatives.map((s) => {
      const nominees = tallyVotes(votes.filter((v) => v.superlative_id === s.id).map((v) => v.nominee_player_id)).map(
        (t) => ({ player_id: t.player_id, player_name: playersById.get(t.player_id)?.name ?? `Player ${t.player_id}`, votes: t.votes }),
      );
      return { ...s, totalVotes: nominees.reduce((sum, n) => sum + n.votes, 0), nominees };
    }),
  };
}

export interface PlayerFeedbackStatus {
  /** Null when the season has no open survey. */
  survey: { answered: boolean } | null;
  /** Null when the season has no open superlatives vote. */
  superlatives: { answered: boolean } | null;
}

/** What a signed-in player is being asked for on a season right now — an open survey and/or an open
 *  superlatives vote — and whether they've already answered. Null if nothing is open or the player
 *  didn't play in the season. Cheap open-state checks run first so a season with nothing open never
 *  pays for the eligibility lookup. */
export async function getPlayerFeedbackStatus(seasonId: number, playerId: number): Promise<PlayerFeedbackStatus | null> {
  const [surveyFound, poll] = await Promise.all([getSurveyForSeason(seasonId), getSuperlativePoll(seasonId)]);
  const surveyOpen = surveyFound && isSurveyOpen(surveyFound.survey) ? surveyFound : null;
  const pollOpen = poll?.isOpen && poll.superlatives.length > 0 ? poll : null;
  if (!surveyOpen && !pollOpen) return null;

  const eligible = await getSeasonPlayedPlayers(seasonId);
  if (!eligible.some((p) => p.player_id === playerId)) return null;

  const [surveyAnswers, votes] = await Promise.all([
    surveyOpen ? getPlayerSurveyAnswers(surveyOpen.survey.id, playerId) : null,
    pollOpen ? getPlayerSuperlativeVotes(seasonId, playerId) : null,
  ]);
  return {
    survey: surveyOpen ? { answered: surveyAnswers!.responded } : null,
    superlatives: pollOpen ? { answered: Object.keys(votes!).length > 0 } : null,
  };
}
