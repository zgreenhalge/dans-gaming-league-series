/**
 * Regression harness for the Schedule Lab's data read — getScheduleLabData.
 *
 * Run:  npx vitest run src/lib/queries-schedule-lab.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestAdminClient } from './supabase-admin';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { matchesSnapshot } from './test-support/snapshot';

__setTestAdminClient(createFakeSupabaseClient(buildFakeDb()));

import { getScheduleLabData } from './queries';
import { test, report } from './test-support/miniTest';

test('getScheduleLabData: every player with ratings, regular-season rosters newest first', async () => {
  const data = await getScheduleLabData();
  const names = data.players.map((p) => p.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  const ids = data.rosters.map((r) => r.seasonId);
  assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
  const known = new Set(data.players.map((p) => p.id));
  for (const r of data.rosters) for (const id of r.playerIds) assert.ok(known.has(id), `roster player ${id} is in the player list`);
  matchesSnapshot('getScheduleLabData', data);
});

report();
