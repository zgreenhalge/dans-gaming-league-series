/**
 * `provisionMatchServer()` and a scrim match's night Discord message: the message is edited once when
 * the match claims the server and once more when the server goes live, and a provision that fails
 * after the claim still leaves the claim's edit. A league match edits no night message.
 *
 * The DatHost client, its config set and the per-match "server live" post are stubbed so the
 * provisioning sequence itself runs; the other dathost-lifecycle tests cover the DB-only functions.
 *
 * Run:  npx vitest run src/lib/dathost-lifecycle-scrim-sync.test.ts
 */

import assert from 'node:assert/strict';
import { vi } from 'vitest';
import { test, report } from './test-support/miniTest';
import type { FakeDb } from './test-support/fakeSupabase';
import { scrimNightStartingIn } from './test-support/scrimFixtures';
import { clientWithNightMessageRpcs, scrimNightMessageTables, watchNightMessageEdits } from './test-support/scrimNightMessageProbe';
import * as dathost from './dathost';
import { provisionMatchServer } from './dathost-lifecycle';

vi.mock('./dathost', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dathost')>()),
  applyConfigSet: vi.fn(async () => {}),
  startServer: vi.fn(async () => {}),
  waitUntilReady: vi.fn(async () => ({ raw_ip: '1.2.3.4', ports: { game: 27015 } })),
  runConsole: vi.fn(async () => {}),
  loadMatch: vi.fn(async () => {}),
  getServer: vi.fn(async () => ({})),
}));
vi.mock('./dathost-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dathost-config')>()),
  resolveConfigSet: vi.fn(async () => ({ server: {}, cs2Settings: {}, cfgFiles: [] })),
  pushCfgFiles: vi.fn(async () => []),
}));
vi.mock('./discord-notify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./discord-notify')>()),
  notifyMatchServerLive: vi.fn(async () => {}),
}));

const NIGHT_ID = 5;
const SCRIM_MATCH_ID = 900;
const LEAGUE_MATCH_ID = 100;
const CONFIG_AUTH = { headerKey: 'X-MatchZy-Token', headerValue: 'sekret' };

function fixture(): { db: FakeDb; client: ReturnType<typeof clientWithNightMessageRpcs> } {
  const db: FakeDb = {
    ...scrimNightMessageTables(NIGHT_ID),
    players: [],
    scrim_nights: [scrimNightStartingIn(-10 * 60 * 1000, NIGHT_ID)],
    scrim_signups: [],
    matches: [
      { id: SCRIM_MATCH_ID, week_id: null, scrim_night_id: NIGHT_ID, match_number: 1, final_score: null, scrim_workshop_id: '3070000111' },
      { id: LEAGUE_MATCH_ID, week_id: 10, scrim_night_id: null, match_number: 1, final_score: null },
    ],
    match_server_state: [],
  };
  return { db, client: clientWithNightMessageRpcs(db) };
}

const provision = (client: ReturnType<typeof fixture>['client'], matchId: number) => {
  process.env.DATHOST_SERVER_ID = 'srv-1';
  return provisionMatchServer(client as never, matchId, 'https://dgls.example.com/config', CONFIG_AUTH, { takeOverLiveServer: true });
};

async function main() {
  await test('provisionMatchServer: a scrim match edits its night message when it claims the server and again once it is live', async () => {
    const { db, client } = fixture();
    const { edits, stop } = watchNightMessageEdits();
    try {
      const result = await provision(client, SCRIM_MATCH_ID);
      assert.equal(result.connect, '1.2.3.4:27015');
      assert.equal(db.match_server_state[0].server_state, 'live');
      assert.equal(edits.length, 2);
    } finally {
      stop();
    }
  });

  await test('provisionMatchServer: a provision that fails after the claim still edits the night message once', async () => {
    const { db, client } = fixture();
    vi.mocked(dathost.loadMatch).mockRejectedValueOnce(new Error('console unreachable'));
    const { edits, stop } = watchNightMessageEdits();
    try {
      await assert.rejects(() => provision(client, SCRIM_MATCH_ID), /console unreachable/);
      assert.equal(db.match_server_state[0].server_state, 'failed');
      await new Promise((resolve) => setTimeout(resolve, 0)); // the claim's edit runs alongside the boot, so it may land after the throw
      assert.equal(edits.length, 1, 'the claim');
    } finally {
      stop();
    }
  });

  await test('provisionMatchServer: a league match edits no night message', async () => {
    const { client } = fixture();
    const { edits, stop } = watchNightMessageEdits();
    try {
      await provision(client, LEAGUE_MATCH_ID);
      assert.equal(edits.length, 0);
    } finally {
      stop();
    }
  });

  report();
}

await main();
