/**
 * Route-handler harness for GET /api/matches/[id]/server/status — who may read a match's server state
 * and connect string: admin or in-match for a league match, any signed-in player for a scrim match.
 *
 * Run:  npx vitest run "src/app/api/matches/[id]/server/status/route.test.ts"
 */

import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient } from '@/lib/test-support/fakeSupabase';
import { sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { GET } from './route';

const ADMIN_ID = 1;
const IN_MATCH_ID = 2;
const OUTSIDER_ID = 3;
const LEAGUE_MATCH_ID = 100;
const SCRIM_MATCH_ID = 101;

function call(matchId: number, sessionPlayerId: number | null) {
  __setTestSession(sessionPlayerId == null ? null : sessionFor(sessionPlayerId));
  return GET(new NextRequest(`http://localhost/api/matches/${matchId}/server/status`), { params: Promise.resolve({ id: String(matchId) }) });
}

function installFixture() {
  __setTestAdminClient(
    createFakeSupabaseClient({
      players: [
        { id: ADMIN_ID, is_admin: true },
        { id: IN_MATCH_ID, is_admin: false },
        { id: OUTSIDER_ID, is_admin: false },
      ],
      matches: [
        { id: LEAGUE_MATCH_ID, week_id: 1, scrim_night_id: null },
        { id: SCRIM_MATCH_ID, week_id: null, scrim_night_id: 5 },
      ],
      player_match_stats: [
        { id: 1, match_id: LEAGUE_MATCH_ID, player_id: IN_MATCH_ID, faction: 'SHIRTS' },
        { id: 2, match_id: SCRIM_MATCH_ID, player_id: IN_MATCH_ID, faction: 'SHIRTS' },
      ],
      match_server_state: [
        { match_id: SCRIM_MATCH_ID, server_state: 'idle', dathost_server_id: null, connect_string: null, server_started_at: null, teardown_at: null },
      ],
    }),
  );
}

async function main() {
  await test('a signed-out request is 401, for a league and a scrim match', async () => {
    installFixture();
    assert.equal((await call(LEAGUE_MATCH_ID, null)).status, 401);
    assert.equal((await call(SCRIM_MATCH_ID, null)).status, 401);
  });

  await test('a league match: an admin and a player in it may read it, an outsider may not', async () => {
    installFixture();
    assert.equal((await call(LEAGUE_MATCH_ID, ADMIN_ID)).status, 200);
    assert.equal((await call(LEAGUE_MATCH_ID, IN_MATCH_ID)).status, 200);
    assert.equal((await call(LEAGUE_MATCH_ID, OUTSIDER_ID)).status, 403);
  });

  await test('a scrim match: any signed-in player may read it', async () => {
    installFixture();
    assert.equal((await call(SCRIM_MATCH_ID, OUTSIDER_ID)).status, 200);
    assert.equal((await call(SCRIM_MATCH_ID, IN_MATCH_ID)).status, 200);
  });

  __setTestSession(undefined);
  __setTestAdminClient(undefined);
  report();
}

await main();
