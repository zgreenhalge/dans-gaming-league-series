/**
 * Route-handler harness for GET /api/scrims/[id]/stats — a night's stat data: 400 for a bad id, 404
 * for an id with no night, the view for a night.
 *
 * Run:  npx vitest run "src/app/api/scrims/[id]/stats/route.test.ts"
 */

import assert from 'node:assert/strict';
import { __setTestAdminClient } from '@/lib/supabase-admin';
import { createFakeSupabaseClient } from '@/lib/test-support/fakeSupabase';
import { test, report } from '@/lib/test-support/miniTest';
import { GET } from './route';

function installFixture() {
  __setTestAdminClient(
    createFakeSupabaseClient({
      players: [{ id: 1, name: 'P1', steam_avatar_url: null }],
      scrim_nights: [{ id: 1, starts_at: '2026-10-30T00:00:00.000Z' }],
      matches: [],
      player_match_stats: [],
    }),
  );
}

const call = (id: string) => GET(new Request(`http://localhost/api/scrims/${id}/stats`), { params: Promise.resolve({ id }) });

async function main() {
  await test('400 for a bad id, 404 for a night that does not exist', async () => {
    installFixture();
    assert.equal((await call('abc')).status, 400);
    assert.equal((await call('99')).status, 404);
  });

  await test('a night with no scored match answers an empty view', async () => {
    installFixture();
    const res = await call('1');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { matches: [], rounds: [], sabremetrics: [], kills: [], weaponClassStats: [], economyStats: [] });
  });

  __setTestAdminClient(undefined);
  report();
}

await main();
