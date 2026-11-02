/**
 * `getLiveTickerMatch()`: the site-wide ticker shows a live league match, and nothing while the live
 * match is a scrim.
 *
 * Run:  npx vitest run src/lib/queries-live-ticker.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestAdminClient } from './supabase-admin';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { test, report } from './test-support/miniTest';
import { getLiveTickerMatch } from './queries';

function installWithLive(matchId: number, scrim: boolean) {
  const db = buildFakeDb();
  if (scrim) {
    const source = db.matches.find((m) => m.id === 100)!;
    db.scrim_nights = [{ id: 1, starts_at: '2026-11-06T01:00:00Z' }];
    db.matches = [...db.matches, { ...source, id: matchId, week_id: null, scrim_night_id: 1 }];
    db.player_match_stats = [
      ...db.player_match_stats,
      ...db.player_match_stats.filter((r) => r.match_id === 100).map((r) => ({ ...r, id: (r.id as number) + 900_000, match_id: matchId })),
    ];
  }
  db.live_match_score = [{ match_id: matchId, shirts_score: 5, skins_score: 3, round: 9, updated_at: '2026-11-05T21:00:00Z' }];
  __setTestAdminClient(createFakeSupabaseClient(db));
}

async function main() {
  await test('getLiveTickerMatch: a live league match shows', async () => {
    installWithLive(100, false);
    const live = await getLiveTickerMatch();
    assert.equal(live?.matchId, 100);
    assert.equal(live?.shirts, 5);
  });

  await test('getLiveTickerMatch: a live scrim match shows nothing', async () => {
    installWithLive(9100, true);
    assert.equal(await getLiveTickerMatch(), null);
  });

  report();
}

await main();

__setTestAdminClient(undefined);
