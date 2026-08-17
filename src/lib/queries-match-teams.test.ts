/**
 * Regression harness for queries/match.ts's team-name and box-score helpers — getMatchTeamNames()
 * (title/roster, shared by getMatchMeta() and the live ticker) and getMatchBoxScore() (per-player
 * K/A/D/ADR, its own query so getMatchTeamNames()'s other callers never pay for it — see the
 * discord-notify.ts redesign this split came from).
 *
 * Run:  npx vitest run src/lib/queries-match-teams.test.ts
 */

import assert from 'node:assert/strict';
import { __setTestClient } from './supabase';
import { createFakeSupabaseClient } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';

__setTestClient(createFakeSupabaseClient(buildFakeDb()));

import { getMatchTeamNames, getMatchBoxScore } from './queries';
import { test, report } from './test-support/miniTest';

async function main() {
  await test('getMatchTeamNames(100) — title split into seasonName + weekMatchLabel, roster joined per side', async () => {
    const teams = await getMatchTeamNames(100);
    assert.notEqual(teams, null);
    assert.equal(teams!.seasonName, 'Season 5');
    assert.equal(teams!.weekMatchLabel, 'Week 1 · Match 1');
    assert.equal(teams!.title, `${teams!.seasonName} · ${teams!.weekMatchLabel}`);
    assert.equal(teams!.shirtNames, 'Alice & Bob');
    assert.equal(teams!.skinNames, 'Carol & Dave');
  });

  await test('getMatchTeamNames(9999) — nonexistent match returns null', async () => {
    assert.equal(await getMatchTeamNames(9999), null);
  });

  await test('getMatchBoxScore(100) — per-player K/A/D/ADR split by faction', async () => {
    const box = await getMatchBoxScore(100);
    assert.equal(box.shirts.length, 2);
    assert.equal(box.skins.length, 2);
    const alice = box.shirts.find((p) => p.name === 'Alice');
    assert.deepEqual(alice, { name: 'Alice', discordNameRoleId: null, kills: 20, assists: 3, deaths: 15, adr: 85.5 });
    const dave = box.skins.find((p) => p.name === 'Dave');
    assert.deepEqual(dave, { name: 'Dave', discordNameRoleId: null, kills: 12, assists: 6, deaths: 20, adr: 60.09 });
  });

  await test('getMatchBoxScore(101) — pre-staged roster with zero stats still returns a row per player', async () => {
    const box = await getMatchBoxScore(101);
    assert.equal(box.shirts.length, 2);
    assert.equal(box.skins.length, 2);
    assert.ok(box.shirts.every((p) => p.kills === 0 && p.adr === 0));
  });

  await test('getMatchBoxScore(9999) — nonexistent match returns empty teams, not an error', async () => {
    assert.deepEqual(await getMatchBoxScore(9999), { shirts: [], skins: [] });
  });

  report();
}

await main();
