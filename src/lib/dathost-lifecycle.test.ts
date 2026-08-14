/**
 * Coverage for the per-match DatHost server state machine. Starts with the pure helpers
 * (matchzyConfigContext(), provisionErrorHandler(), occupancyMessage(), pugModeCvarLine()) directly
 * via miniTest.ts, then the DB-reading/reconciliation functions against fakeSupabase.ts.
 *
 * No live DatHost connection exists in this environment. Rather than mock `fetch` (against
 * docs/patterns.md's IO-boundary convention), this exploits the real, documented failure modes of
 * the functions under test: findServerOccupant()/findNearbyUnscoredMatch()/fetchServerStateRow() are
 * pure DB reads that never touch DatHost at all; getReconciledServerState()'s `idle`/`provisioning`/
 * `tearing_down`-not-yet-due branches likewise never call out; its `live` branch's real DatHost call
 * fails fast without a live connection, which its own `catch { keep DB value }` is specifically
 * designed to absorb — exercising that IS testing real, intended behavior, not a mocked one.
 * provisionMatchServer()/teardownMatchServer()'s actual network-touching happy paths are left
 * untested here (already indirectly covered by the route tests' failure-path assertions).
 *
 * Run:  npx vitest run src/lib/dathost-lifecycle.test.ts
 */

import assert from 'node:assert/strict';
import { test, report } from './test-support/miniTest';
import { createFakeSupabaseClient, type FakeDb } from './test-support/fakeSupabase';
import {
  matchzyConfigContext,
  provisionErrorHandler,
  occupancyMessage,
  pugModeCvarLine,
  findServerOccupant,
  findNearbyUnscoredMatch,
  fetchServerStateRow,
  getReconciledServerState,
  getActiveServerMatch,
  getServerOccupancy,
  teardownMatchServer,
  ServerBusyError,
  type ActiveServerMatch,
  type ServerOccupancy,
} from './dathost-lifecycle';

async function withEnvAsync<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ─── pure helpers ────────────────────────────────────────────────────────────

async function testMatchzyConfigContext() {
  await test('matchzyConfigContext: null when MATCHZY_CONFIG_SECRET is unset', async () => {
    await withEnvAsync({ MATCHZY_CONFIG_SECRET: undefined }, async () => {
      assert.equal(matchzyConfigContext('https://dgls.example.com', 100), null);
    });
  });

  await test('matchzyConfigContext: builds the authenticated config URL + header when configured', async () => {
    await withEnvAsync({ MATCHZY_CONFIG_SECRET: 'sekret' }, async () => {
      const ctx = matchzyConfigContext('https://dgls.example.com', 100);
      assert.deepEqual(ctx, {
        configUrl: 'https://dgls.example.com/api/matches/100/matchzy-config',
        configAuth: { headerKey: 'X-MatchZy-Token', headerValue: 'sekret' },
      });
    });
  });
}

test('occupancyMessage: names the occupying match when one is active', () => {
  const occupancy: ServerOccupancy = {
    active: { matchId: 5, label: 'Season 5 · Wk 2 · Match 1', serverState: 'live', connectString: '1.2.3.4:27015', serverStartedAt: null },
    playersOnline: null,
    occupied: true,
  };
  assert.equal(occupancyMessage(occupancy), 'Match Season 5 · Wk 2 · Match 1 is currently live on this server.');
});

test('occupancyMessage: reports the raw player count with no DGLS match active', () => {
  assert.equal(occupancyMessage({ active: null, playersOnline: 3, occupied: true }), '3 player(s) are currently on the server outside of a DGLS match.');
  assert.equal(occupancyMessage({ active: null, playersOnline: null, occupied: false }), '0 player(s) are currently on the server outside of a DGLS match.');
});

async function testProvisionErrorHandler() {
  await test('provisionErrorHandler: a ServerBusyError only warns, no ops-error recorded', async () => {
    const db: FakeDb = { ops_errors: [] };
    const client = createFakeSupabaseClient(db);
    const handler = provisionErrorHandler(client as never, 'provision', 100);
    await handler(new ServerBusyError(200));
    assert.equal(db.ops_errors.length, 0);
  });

  await test('provisionErrorHandler: any other error records a server_provision ops-error', async () => {
    const db: FakeDb = { ops_errors: [] };
    const client = createFakeSupabaseClient(db);
    const handler = provisionErrorHandler(client as never, 'provision', 100);
    await handler(new Error('boom'));
    assert.equal(db.ops_errors.length, 1);
    assert.equal(db.ops_errors[0].operation, 'server_provision');
    assert.equal(db.ops_errors[0].entity_id, 100);
    assert.ok((db.ops_errors[0].message as string).includes('boom'));
  });
}

test('pugModeCvarLine: includes the playout toggle and omits friendly cvars by default', () => {
  const line = pugModeCvarLine({ playout: true, friendly: false });
  assert.ok(line.includes('matchzy_playout_enabled_default 1'));
  assert.ok(!line.includes('mp_autokick 0'));
});

test('pugModeCvarLine: includes FRIENDLY_CVARS when friendly is on', () => {
  const line = pugModeCvarLine({ playout: false, friendly: true });
  assert.ok(line.includes('matchzy_playout_enabled_default 0'));
  assert.ok(line.includes('mp_autokick 0'));
  assert.ok(line.includes('mp_drop_knife_enable 1'));
});

// ─── DB-only reads ───────────────────────────────────────────────────────────

async function testFindServerOccupant() {
  await test('findServerOccupant: null when DATHOST_SERVER_ID is unset (nothing to contend for)', async () => {
    const db: FakeDb = { match_server_state: [{ match_id: 5, server_state: 'live', dathost_server_id: 'srv-1' }] };
    const client = createFakeSupabaseClient(db);
    const result = await withEnvAsync({ DATHOST_SERVER_ID: undefined }, () => findServerOccupant(client as never, 100));
    assert.equal(result, null);
  });

  await test('findServerOccupant: finds another match occupying the shared server', async () => {
    const db: FakeDb = {
      match_server_state: [
        { match_id: 5, server_state: 'live', dathost_server_id: 'srv-1' },
        { match_id: 6, server_state: 'done', dathost_server_id: 'srv-1' }, // not occupying
        { match_id: 7, server_state: 'live', dathost_server_id: 'srv-2' }, // different server
      ],
    };
    const client = createFakeSupabaseClient(db);
    const result = await withEnvAsync({ DATHOST_SERVER_ID: 'srv-1' }, () => findServerOccupant(client as never, 100));
    assert.equal(result, 5);
  });

  await test('findServerOccupant: excludes the asking match itself', async () => {
    const db: FakeDb = { match_server_state: [{ match_id: 100, server_state: 'live', dathost_server_id: 'srv-1' }] };
    const client = createFakeSupabaseClient(db);
    const result = await withEnvAsync({ DATHOST_SERVER_ID: 'srv-1' }, () => findServerOccupant(client as never, 100));
    assert.equal(result, null);
  });
}

async function testFindNearbyUnscoredMatch() {
  await test('findNearbyUnscoredMatch: picks the nearest unplayed match within the window, skipping played ones', async () => {
    const now = Date.now();
    const db: FakeDb = {
      weeks: [{ id: 1, season_id: 1, week_number: 2 }],
      seasons: [{ id: 1, name: 'Season 5' }],
      matches: [
        { id: 100, week_id: 1, match_number: 1, scheduled_at: new Date(now - 60_000).toISOString(), final_score: null },
        { id: 101, week_id: 1, match_number: 2, scheduled_at: new Date(now - 5_000).toISOString(), final_score: null }, // nearest
        { id: 102, week_id: 1, match_number: 3, scheduled_at: new Date(now).toISOString(), final_score: '13-9' }, // played -> skipped despite being nearest
      ],
    };
    const client = createFakeSupabaseClient(db);
    const result = await findNearbyUnscoredMatch(client as never, 10 * 60 * 1000);
    assert.equal(result?.matchId, 101);
    assert.equal(result?.label, 'Season 5 · Wk 2 · Match 2');
  });

  await test('findNearbyUnscoredMatch: null when nothing is scheduled nearby', async () => {
    const db: FakeDb = { weeks: [], seasons: [], matches: [] };
    const client = createFakeSupabaseClient(db);
    assert.equal(await findNearbyUnscoredMatch(client as never), null);
  });
}

async function testFetchServerStateRow() {
  await test('fetchServerStateRow: null when the match has never been provisioned', async () => {
    const db: FakeDb = { match_server_state: [] };
    const client = createFakeSupabaseClient(db);
    assert.equal(await fetchServerStateRow(client as never, 100), null);
  });

  await test('fetchServerStateRow: the raw DB row, unreconciled', async () => {
    const db: FakeDb = { match_server_state: [{ match_id: 100, server_state: 'live', connect_string: '1.2.3.4:27015', server_started_at: null, dathost_server_id: 'srv-1', teardown_at: null }] };
    const client = createFakeSupabaseClient(db);
    const row = await fetchServerStateRow(client as never, 100);
    assert.equal(row?.server_state, 'live');
    assert.equal(row?.connect_string, '1.2.3.4:27015');
  });
}

async function testGetReconciledServerState() {
  await test('getReconciledServerState: idle when no row exists', async () => {
    const db: FakeDb = { match_server_state: [] };
    const client = createFakeSupabaseClient(db);
    assert.deepEqual(await getReconciledServerState(client as never, 100), { serverState: 'idle', connectString: null, serverStartedAt: null });
  });

  await test('getReconciledServerState: provisioning passes through unchanged (never touches DatHost)', async () => {
    const db: FakeDb = { match_server_state: [{ match_id: 100, server_state: 'provisioning', connect_string: null, server_started_at: '2026-01-01T00:00:00Z', dathost_server_id: 'srv-1', teardown_at: null }] };
    const client = createFakeSupabaseClient(db);
    const result = await getReconciledServerState(client as never, 100);
    assert.equal(result.serverState, 'provisioning');
  });

  await test('getReconciledServerState: tearing_down with a future teardown_at is not due yet — untouched', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const db: FakeDb = { match_server_state: [{ match_id: 100, server_state: 'tearing_down', connect_string: null, server_started_at: null, dathost_server_id: 'srv-1', teardown_at: future }] };
    const client = createFakeSupabaseClient(db);
    const result = await withEnvAsync({ DATHOST_SERVER_ID: 'srv-1' }, () => getReconciledServerState(client as never, 100));
    assert.equal(result.serverState, 'tearing_down');
  });

  await test('getReconciledServerState: a due teardown that fails (no live DatHost) stays tearing_down and records an ops-error', async () => {
    const db: FakeDb = {
      match_server_state: [{ match_id: 100, server_state: 'tearing_down', connect_string: null, server_started_at: null, dathost_server_id: 'srv-1', teardown_at: null }],
      scrim_sessions: [],
      ops_errors: [],
    };
    const client = createFakeSupabaseClient(db);
    const result = await withEnvAsync({ DATHOST_SERVER_ID: 'srv-1' }, () => getReconciledServerState(client as never, 100));
    assert.equal(result.serverState, 'tearing_down');
    assert.ok(db.ops_errors.some((e) => e.operation === 'server_teardown'));
  });

  await test('getReconciledServerState: live with no DATHOST_SERVER_ID configured is never reconciled', async () => {
    const db: FakeDb = { match_server_state: [{ match_id: 100, server_state: 'live', connect_string: '1.2.3.4:27015', server_started_at: null, dathost_server_id: 'srv-1', teardown_at: null }] };
    const client = createFakeSupabaseClient(db);
    const result = await withEnvAsync({ DATHOST_SERVER_ID: undefined }, () => getReconciledServerState(client as never, 100));
    assert.equal(result.serverState, 'live');
    assert.equal(result.connectString, '1.2.3.4:27015');
  });

  await test('getReconciledServerState: live with DatHost unreachable keeps the DB value (its own designed fallback)', async () => {
    const db: FakeDb = { match_server_state: [{ match_id: 100, server_state: 'live', connect_string: '1.2.3.4:27015', server_started_at: null, dathost_server_id: 'srv-1', teardown_at: null }] };
    const client = createFakeSupabaseClient(db);
    const result = await withEnvAsync({ DATHOST_SERVER_ID: 'srv-1', DATHOST_EMAIL: undefined, DATHOST_PASSWORD: undefined }, () =>
      getReconciledServerState(client as never, 100),
    );
    assert.equal(result.serverState, 'live');
    assert.equal(result.connectString, '1.2.3.4:27015');
  });
}

async function testGetActiveServerMatch() {
  await test('getActiveServerMatch: null when DATHOST_SERVER_ID is unset', async () => {
    const db: FakeDb = { match_server_state: [] };
    const client = createFakeSupabaseClient(db);
    const result = await withEnvAsync({ DATHOST_SERVER_ID: undefined }, () => getActiveServerMatch(client as never));
    assert.equal(result, null);
  });

  await test('getActiveServerMatch: null when nothing occupies the server', async () => {
    const db: FakeDb = { match_server_state: [] };
    const client = createFakeSupabaseClient(db);
    const result = await withEnvAsync({ DATHOST_SERVER_ID: 'srv-1' }, () => getActiveServerMatch(client as never));
    assert.equal(result, null);
  });

  await test('getActiveServerMatch: the provisioning occupant, with a label built from its match/week/season', async () => {
    const db: FakeDb = {
      match_server_state: [{ match_id: 100, server_state: 'provisioning', connect_string: null, server_started_at: '2026-01-01T00:00:00Z', dathost_server_id: 'srv-1', teardown_at: null }],
      matches: [{ id: 100, week_id: 1, match_number: 3 }],
      weeks: [{ id: 1, season_id: 1, week_number: 2 }],
      seasons: [{ id: 1, name: 'Season 5' }],
    };
    const client = createFakeSupabaseClient(db);
    const result = await withEnvAsync({ DATHOST_SERVER_ID: 'srv-1' }, () => getActiveServerMatch(client as never));
    assert.deepEqual(result satisfies ActiveServerMatch | null, {
      matchId: 100,
      label: 'Season 5 · Wk 2 · Match 3',
      serverState: 'provisioning',
      connectString: null,
      serverStartedAt: '2026-01-01T00:00:00Z',
    });
  });
}

async function testGetServerOccupancy() {
  await test('getServerOccupancy: occupied via an active DGLS match', async () => {
    const db: FakeDb = {
      match_server_state: [{ match_id: 100, server_state: 'live', connect_string: '1.2.3.4:27015', server_started_at: null, dathost_server_id: 'srv-1', teardown_at: null }],
      matches: [{ id: 100, week_id: 1, match_number: 1 }],
      weeks: [{ id: 1, season_id: 1, week_number: 1 }],
      seasons: [{ id: 1, name: 'Season 5' }],
    };
    const client = createFakeSupabaseClient(db);
    const result = await withEnvAsync({ DATHOST_SERVER_ID: 'srv-1' }, () => getServerOccupancy(client as never, null));
    assert.equal(result.occupied, true);
    assert.ok(result.active);
  });

  await test('getServerOccupancy: occupied via raw players present with no DGLS match', async () => {
    const db: FakeDb = { match_server_state: [] };
    const client = createFakeSupabaseClient(db);
    const server = { players_online: 2 } as never;
    const result = await withEnvAsync({ DATHOST_SERVER_ID: 'srv-1' }, () => getServerOccupancy(client as never, server));
    assert.deepEqual(result, { active: null, playersOnline: 2, occupied: true });
  });

  await test('getServerOccupancy: not occupied when neither signal is present', async () => {
    const db: FakeDb = { match_server_state: [] };
    const client = createFakeSupabaseClient(db);
    const result = await withEnvAsync({ DATHOST_SERVER_ID: undefined }, () => getServerOccupancy(client as never, null));
    assert.deepEqual(result, { active: null, playersOnline: null, occupied: false });
  });
}

// ─── teardownMatchServer's no-DatHost-call branches ─────────────────────────

async function testTeardownNoOpBranches() {
  await test('teardownMatchServer: onlyIfOwnsServer no-ops when the match has no active row', async () => {
    const db: FakeDb = { match_server_state: [] };
    const client = createFakeSupabaseClient(db);
    await withEnvAsync({ DATHOST_SERVER_ID: 'srv-1' }, () => teardownMatchServer(client as never, 100, { onlyIfOwnsServer: true }));
    assert.equal(db.match_server_state.length, 0, 'no row should have been written');
  });

  await test('teardownMatchServer: onlyIfOwnsServer no-ops when a different server owns the row', async () => {
    const db: FakeDb = { match_server_state: [{ match_id: 100, server_state: 'live', connect_string: '1.2.3.4:27015', server_started_at: null, dathost_server_id: 'srv-OTHER', teardown_at: null }] };
    const client = createFakeSupabaseClient(db);
    await withEnvAsync({ DATHOST_SERVER_ID: 'srv-1' }, () => teardownMatchServer(client as never, 100, { onlyIfOwnsServer: true }));
    assert.equal(db.match_server_state[0].server_state, 'live', 'the row must be left untouched');
  });

  await test('teardownMatchServer: delayMs schedules a future teardown without calling DatHost', async () => {
    const db: FakeDb = { match_server_state: [] };
    const client = createFakeSupabaseClient(db);
    await withEnvAsync({ DATHOST_SERVER_ID: 'srv-1' }, () => teardownMatchServer(client as never, 100, { delayMs: 60_000 }));
    const row = db.match_server_state.find((r) => r.match_id === 100)!;
    assert.equal(row.server_state, 'tearing_down');
    assert.ok(row.teardown_at);
    assert.ok(Date.parse(row.teardown_at as string) > Date.now());
  });
}

async function main() {
  await testMatchzyConfigContext();
  await testProvisionErrorHandler();
  await testFindServerOccupant();
  await testFindNearbyUnscoredMatch();
  await testFetchServerStateRow();
  await testGetReconciledServerState();
  await testGetActiveServerMatch();
  await testGetServerOccupancy();
  await testTeardownNoOpBranches();
  report();
}

await main();
