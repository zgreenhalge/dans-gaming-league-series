/**
 * Route-handler tests for scrim night matches: POST /api/scrims/[date]/matches (make the next match)
 * and PATCH/DELETE /api/scrims/matches/[id] (change the map or lineup, or discard). Covers who may
 * act, the four-player minimum, one unplayed match at a time, lineups drawn only from checked-in
 * players, and the lock once a match has started.
 *
 * Run:  npx vitest run src/app/api/scrims/matches/[id]/route.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestSession } from '@/lib/session';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from '@/lib/test-support/fakeSupabase';
import { scrimMatchRpcs } from '@/lib/test-support/scrimMatchRpcs';
import { jsonRequest, sessionFor } from '@/lib/test-support/nextRequest';
import { test, report } from '@/lib/test-support/miniTest';
import { scrimScheduleStartingIn } from '@/lib/test-support/scrimFixtures';
import { POST as CREATE } from '../../[date]/matches/route';
import { PATCH, DELETE } from './route';

const ADMIN_ID = 1;
const OUTSIDER_ID = 9;
const NIGHT_ID = 5;

/** Players 1 (admin) and 2–7, with `checkedIn` of them checked in to the night. */
function installFixture(checkedIn: number[], extra: Partial<FakeDb> = {}): { db: FakeDb; date: string } {
  // Starts in 10 minutes, so check-in is open on the real clock.
  const { row, date } = scrimScheduleStartingIn(10 * 60 * 1000);
  const db: FakeDb = {
    players: [1, 2, 3, 4, 5, 6, 7, OUTSIDER_ID].map((id) => ({ id, name: `P${id}`, is_admin: id === ADMIN_ID, seed_ehog: null })),
    player_rating_history: [],
    scrim_schedule: [row],
    scrim_nights: [{ id: NIGHT_ID, night_date: date, cancelled: false }],
    scrim_signups: checkedIn.map((player_id, i) => ({
      id: i + 1,
      night_id: NIGHT_ID,
      player_id,
      commitment: 'definite',
      signed_up_at: `2026-01-01T00:00:0${i}Z`,
      checked_in_at: '2026-01-01T01:00:00Z',
    })),
    maps: [
      { id: 1, name: 'Foroglio', workshop_url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=3070000111' },
      { id: 2, name: 'Cobblestone', workshop_url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=3070000222' },
    ],
    matches: [],
    player_match_stats: [],
    match_server_state: [],
    ...extra,
  };
  __setTestAdminClient(createFakeSupabaseClient(db, scrimMatchRpcs));
  return { db, date };
}

const create = (date: string) =>
  CREATE(jsonRequest(`http://localhost/api/scrims/${date}/matches`, 'POST', {}), { params: Promise.resolve({ date }) });
const patch = (id: number, body: unknown) =>
  PATCH(jsonRequest(`http://localhost/api/scrims/matches/${id}`, 'PATCH', body), { params: Promise.resolve({ id: String(id) }) });
const discard = (id: number) =>
  DELETE(jsonRequest(`http://localhost/api/scrims/matches/${id}`, 'DELETE', {}), { params: Promise.resolve({ id: String(id) }) });

const lineupOf = (db: FakeDb, matchId: number) =>
  db.player_match_stats.filter((r) => r.match_id === matchId).map((r) => r.player_id as number).sort((a, b) => a - b);

async function makeMatch(db: FakeDb, date: string): Promise<number> {
  __setTestSession(sessionFor(2));
  const res = await create(date);
  assert.equal(res.status, 201);
  return ((await res.json()) as { matchId: number }).matchId;
}

async function main() {
  await test('create: a checked-in player makes a match of four checked-in players on a known map', async () => {
    const { db, date } = installFixture([2, 3, 4, 5, 6]);
    const matchId = await makeMatch(db, date);
    const match = db.matches.find((m) => m.id === matchId)!;
    assert.equal(match.scrim_night_id, NIGHT_ID);
    assert.equal(match.week_id, null);
    assert.ok(['Foroglio', 'Cobblestone'].includes(match.shirts_pick as string));
    assert.equal(match.scrim_workshop_id, match.shirts_pick === 'Foroglio' ? '3070000111' : '3070000222');
    const lineup = lineupOf(db, matchId);
    assert.equal(lineup.length, 4);
    assert.ok(lineup.every((id) => [2, 3, 4, 5, 6].includes(id)));
  });

  await test('create: 403 for a player who is not checked in; an admin can', async () => {
    const { date } = installFixture([2, 3, 4, 5]);
    __setTestSession(sessionFor(OUTSIDER_ID));
    assert.equal((await create(date)).status, 403);
    __setTestSession(sessionFor(ADMIN_ID));
    assert.equal((await create(date)).status, 201);
  });

  await test('create: 409 with fewer than four checked in', async () => {
    const { date } = installFixture([2, 3, 4]);
    __setTestSession(sessionFor(2));
    assert.equal((await create(date)).status, 409);
  });

  await test('create: 409 while the night has an unplayed match; fine once it is scored', async () => {
    const { db, date } = installFixture([2, 3, 4, 5]);
    const first = await makeMatch(db, date);
    assert.equal((await create(date)).status, 409);
    db.matches.find((m) => m.id === first)!.final_score = '13-7';
    const res = await create(date);
    assert.equal(res.status, 201);
    const second = ((await res.json()) as { matchId: number }).matchId;
    assert.equal(db.matches.find((m) => m.id === second)!.match_number, 2);
  });

  await test('patch: a player in the match changes the map by workshop link; text that is not one is refused', async () => {
    const { db, date } = installFixture([2, 3, 4, 5]);
    const matchId = await makeMatch(db, date);
    const inMatch = lineupOf(db, matchId)[0];
    __setTestSession(sessionFor(inMatch));
    assert.equal((await patch(matchId, { workshop: 'https://steamcommunity.com/sharedfiles/filedetails/?id=3070000222' })).status, 200);
    const match = db.matches.find((m) => m.id === matchId)!;
    assert.deepEqual([match.shirts_pick, match.scrim_workshop_id], ['Cobblestone', '3070000222']);
    assert.equal((await patch(matchId, { workshop: 'not a map' })).status, 400);
  });

  await test('patch: the starting side choice is stored as chosen, random included; the side itself waits for the start', async () => {
    const { db, date } = installFixture([2, 3, 4, 5]);
    const matchId = await makeMatch(db, date);
    const match = db.matches.find((m) => m.id === matchId)!;
    assert.equal(match.scrim_side_choice, 'knife');
    __setTestSession(sessionFor(ADMIN_ID));
    for (const side of ['skins_t', 'shirts_t', 'random', 'knife']) {
      assert.equal((await patch(matchId, { side })).status, 200);
      assert.equal(match.scrim_side_choice, side);
    }
    assert.equal(match.skins_starting_side ?? null, null);
    assert.equal((await patch(matchId, { side: 'ct' })).status, 400);
  });

  await test('patch: the lineup can swap in another checked-in player, but not someone not checked in', async () => {
    const { db, date } = installFixture([2, 3, 4, 5, 6]);
    const matchId = await makeMatch(db, date);
    const inMatch = lineupOf(db, matchId);
    const benched = [2, 3, 4, 5, 6].find((id) => !inMatch.includes(id))!;
    __setTestSession(sessionFor(inMatch[0]));
    const lineup = { shirts: [inMatch[0], benched], skins: [inMatch[2], inMatch[3]] };
    assert.equal((await patch(matchId, { lineup })).status, 200);
    assert.deepEqual(lineupOf(db, matchId), [...lineup.shirts, ...lineup.skins].sort((a, b) => a - b));
    assert.equal((await patch(matchId, { lineup: { shirts: [inMatch[0], 7], skins: [inMatch[2], inMatch[3]] } })).status, 400);
    assert.equal((await patch(matchId, { lineup: { shirts: [inMatch[0], inMatch[0]], skins: [inMatch[2], inMatch[3]] } })).status, 400);
  });

  await test('patch/delete: 403 for a player not in the match; an admin can act', async () => {
    const { db, date } = installFixture([2, 3, 4, 5, 6]);
    const matchId = await makeMatch(db, date);
    const benched = [2, 3, 4, 5, 6].find((id) => !lineupOf(db, matchId).includes(id))!;
    __setTestSession(sessionFor(benched));
    assert.equal((await patch(matchId, { workshop: '3070000222' })).status, 403);
    assert.equal((await discard(matchId)).status, 403);
    __setTestSession(sessionFor(ADMIN_ID));
    assert.equal((await discard(matchId)).status, 200);
    assert.equal(db.matches.length, 0);
  });

  await test('patch/delete: 409 once the match has started', async () => {
    const { db, date } = installFixture([2, 3, 4, 5]);
    const matchId = await makeMatch(db, date);
    db.match_server_state.push({ match_id: matchId, server_state: 'live' });
    __setTestSession(sessionFor(ADMIN_ID));
    assert.equal((await patch(matchId, { workshop: '3070000222' })).status, 409);
    assert.equal((await discard(matchId)).status, 409);
  });

  await test('a match whose server stopped without a score can be discarded but not changed', async () => {
    const { db, date } = installFixture([2, 3, 4, 5]);
    const matchId = await makeMatch(db, date);
    db.match_server_state.push({ match_id: matchId, server_state: 'done' });
    __setTestSession(sessionFor(ADMIN_ID));
    assert.equal((await patch(matchId, { workshop: '3070000222' })).status, 409);
    assert.equal((await discard(matchId)).status, 200);
    assert.equal(db.matches.length, 0);
  });

  await test('patch: a player who checked out can stay in the lineup while another slot changes', async () => {
    const { db, date } = installFixture([2, 3, 4, 5, 6]);
    const matchId = await makeMatch(db, date);
    const inMatch = lineupOf(db, matchId);
    const benched = [2, 3, 4, 5, 6].find((id) => !inMatch.includes(id))!;
    const leaver = inMatch[0];
    db.scrim_signups.find((s) => s.player_id === leaver)!.checked_in_at = null;
    __setTestSession(sessionFor(ADMIN_ID));
    const lineup = { shirts: [leaver, inMatch[1]], skins: [benched, inMatch[3]] };
    assert.equal((await patch(matchId, { lineup })).status, 200);
    assert.deepEqual(lineupOf(db, matchId), [...lineup.shirts, ...lineup.skins].sort((a, b) => a - b));
  });

  await test('patch: a failed start unlocks the match again', async () => {
    const { db, date } = installFixture([2, 3, 4, 5]);
    const matchId = await makeMatch(db, date);
    db.match_server_state.push({ match_id: matchId, server_state: 'failed' });
    __setTestSession(sessionFor(ADMIN_ID));
    assert.equal((await patch(matchId, { workshop: '3070000222' })).status, 200);
  });

  await test('patch: 404 for a league match', async () => {
    installFixture([2, 3, 4, 5], {
      matches: [{ id: 50, week_id: 10, scrim_night_id: null, match_number: 1, final_score: null }],
      player_match_stats: [{ id: 1, match_id: 50, player_id: ADMIN_ID, faction: 'SHIRTS' }],
    });
    __setTestSession(sessionFor(ADMIN_ID));
    assert.equal((await patch(50, { workshop: '3070000222' })).status, 404);
  });

  report();
}

await main();

__setTestSession(undefined);
__setTestAdminClient(undefined);
