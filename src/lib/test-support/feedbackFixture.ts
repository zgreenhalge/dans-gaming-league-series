// Shared in-memory league for the survey / superlatives route tests: one regular season with a
// paired gauntlet, where players 1-3 played a match with a played score and player 4 is only on an
// unplayed (`"0-0"`) placeholder — so exactly 1-3 are eligible.

import { __setTestSession } from '../session';
import { __setTestAdminClient } from '../supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from './fakeSupabase';
import { superlativeRpcs } from './superlativeRpcs';
import { surveyRpcs } from './surveyRpcs';
import { sessionFor } from './nextRequest';

export const ADMIN_ID = 1;
export const ALICE_ID = 2;
export const BOB_ID = 3;
export const CARA_ID = 4;
export const REGULAR_SEASON_ID = 1;
export const GAUNTLET_SEASON_ID = 2;

export function makeFeedbackDb(): FakeDb {
  const player = (id: number, name: string, is_admin = false) => ({
    id, name, is_admin, steam_avatar_url: null, discord_id: null,
  });
  return {
    players: [player(ADMIN_ID, 'Admin', true), player(ALICE_ID, 'Alice'), player(BOB_ID, 'Bob'), player(CARA_ID, 'Cara')],
    seasons: [
      { id: REGULAR_SEASON_ID, name: 'Season 1', status: 'ARCHIVED', is_gauntlet: false },
      { id: GAUNTLET_SEASON_ID, name: 'Season 1 Gauntlet', status: 'ARCHIVED', is_gauntlet: true },
    ],
    weeks: [
      { id: 10, season_id: REGULAR_SEASON_ID, week_number: 1 },
      { id: 20, season_id: GAUNTLET_SEASON_ID, week_number: 1 },
    ],
    matches: [
      { id: 100, week_id: 10, final_score: '13-9' },
      { id: 101, week_id: 10, final_score: '0-0' },
      { id: 200, week_id: 20, final_score: '13-5' },
    ],
    player_match_stats: [
      { id: 1, match_id: 100, player_id: ADMIN_ID },
      { id: 2, match_id: 100, player_id: ALICE_ID },
      { id: 3, match_id: 101, player_id: CARA_ID },
      { id: 4, match_id: 200, player_id: BOB_ID },
    ],
    surveys: [],
    survey_responses: [],
    superlative_polls: [],
    superlatives: [],
    superlative_votes: [],
  };
}

/** Installs a fresh fixture as both Supabase clients and signs in as `playerId` (or nobody). */
export function installFeedbackFixture(playerId: number | null): FakeDb {
  const db = makeFeedbackDb();
  const client = createFakeSupabaseClient(db, { ...superlativeRpcs, ...surveyRpcs });
  __setTestAdminClient(client);
  __setTestSession(playerId == null ? null : sessionFor(playerId));
  return db;
}

export function resetFeedbackFixture(): void {
  __setTestSession(undefined);
  __setTestAdminClient(undefined);
}
