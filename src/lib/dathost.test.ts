/**
 * Coverage for dathost.ts's pure, IO-free surface — buildScalarFields(), dathostServerId(),
 * workshopIdFromUrl(), connectHost(), isDathostNotFound(), and applyConfigSet()'s no-mapWorkshopId
 * guard (which throws before ever calling the DatHost API, so it needs no mock to exercise).
 *
 * Per docs/patterns.md's "Test external IO by extracting the logic around it, not by mocking the
 * call": the network-hitting functions (request(), call(), getServer(), startServer(), etc.) stay
 * untested here, same as fetchFromDathost.test.ts leaves fetchDemoFromDathost() untested — only the
 * decision logic that sits beside those calls is covered.
 *
 * Run:  npx tsx src/lib/dathost.test.ts
 */

import assert from 'node:assert/strict';
import { test, report } from './test-support/miniTest';
import { buildScalarFields, dathostServerId, workshopIdFromUrl, connectHost, isDathostNotFound, applyConfigSet, DathostError, type DathostServer } from './dathost';

// ─── buildScalarFields ───────────────────────────────────────────────────────

test('buildScalarFields: converts scalars to strings, with no prefix by default', () => {
  assert.deepEqual(buildScalarFields({ a: 1, b: 'two', c: true }), { a: '1', b: 'two', c: 'true' });
});

test('buildScalarFields: applies a prefix to every key', () => {
  assert.deepEqual(buildScalarFields({ a: 1 }, { prefix: 'cs2_settings.' }), { 'cs2_settings.a': '1' });
});

test('buildScalarFields: skips keys in exclude', () => {
  assert.deepEqual(buildScalarFields({ a: 1, b: 2 }, { exclude: new Set(['b']) }), { a: '1' });
});

test('buildScalarFields: skips any object value (null, array, or nested object) and reports it via onSkip', () => {
  const skipped: string[] = [];
  const result = buildScalarFields(
    { scalar: 1, nullish: null, list: [1, 2], nested: { x: 1 } },
    { onSkip: (key) => skipped.push(key) },
  );
  assert.deepEqual(result, { scalar: '1' });
  assert.deepEqual(skipped.sort(), ['list', 'nested', 'nullish']);
});

// ─── dathostServerId ─────────────────────────────────────────────────────────

test('dathostServerId: returns the configured id', () => {
  const prev = process.env.DATHOST_SERVER_ID;
  process.env.DATHOST_SERVER_ID = 'srv-123';
  assert.equal(dathostServerId(), 'srv-123');
  if (prev === undefined) delete process.env.DATHOST_SERVER_ID;
  else process.env.DATHOST_SERVER_ID = prev;
});

test('dathostServerId: throws when unset', () => {
  const prev = process.env.DATHOST_SERVER_ID;
  delete process.env.DATHOST_SERVER_ID;
  assert.throws(() => dathostServerId(), /DATHOST_SERVER_ID must be set/);
  if (prev !== undefined) process.env.DATHOST_SERVER_ID = prev;
});

// ─── workshopIdFromUrl ───────────────────────────────────────────────────────

test('workshopIdFromUrl: extracts the id query param', () => {
  assert.equal(workshopIdFromUrl('https://steamcommunity.com/sharedfiles/filedetails/?id=123456'), '123456');
});

test('workshopIdFromUrl: null for a missing url', () => {
  assert.equal(workshopIdFromUrl(null), null);
  assert.equal(workshopIdFromUrl(undefined), null);
});

test('workshopIdFromUrl: null when the url has no id param', () => {
  assert.equal(workshopIdFromUrl('https://steamcommunity.com/sharedfiles/filedetails/'), null);
});

// ─── connectHost ─────────────────────────────────────────────────────────────

function server(overrides: Partial<DathostServer> = {}): DathostServer {
  return {
    id: 's1', name: 'DGLS', on: true, booting: false, ip: null, raw_ip: null, custom_domain: null,
    ports: { game: 27015, gotv: null }, match_id: null, cs2_settings: null, server_error: null, players_online: 0,
    ...overrides,
  };
}

test('connectHost: prefers raw_ip over ip and custom_domain', () => {
  assert.equal(connectHost(server({ raw_ip: '1.2.3.4', ip: '5.6.7.8', custom_domain: 'srv.example.com' })), '1.2.3.4:27015');
});

test('connectHost: falls back to ip, then custom_domain', () => {
  assert.equal(connectHost(server({ ip: '5.6.7.8' })), '5.6.7.8:27015');
  assert.equal(connectHost(server({ custom_domain: 'srv.example.com' })), 'srv.example.com:27015');
});

test('connectHost: null when no host is available', () => {
  assert.equal(connectHost(server()), null);
});

test('connectHost: null when no game port is available', () => {
  assert.equal(connectHost(server({ raw_ip: '1.2.3.4', ports: null })), null);
});

// ─── isDathostNotFound ───────────────────────────────────────────────────────

test('isDathostNotFound: true only for a DathostError with status 404', () => {
  assert.equal(isDathostNotFound(new DathostError('not found', 404, null)), true);
  assert.equal(isDathostNotFound(new DathostError('server error', 500, null)), false);
  assert.equal(isDathostNotFound(new Error('plain error')), false);
  assert.equal(isDathostNotFound('a string'), false);
});

// ─── applyConfigSet's no-mapWorkshopId guard ─────────────────────────────────

async function main() {
  await test('applyConfigSet: throws before any network call when no map workshop id is resolved', async () => {
    await assert.rejects(
      () => applyConfigSet('srv-1', { server: {}, cs2Settings: {} }),
      /requires a resolved map workshop id/,
    );
  });
  report();
}

main();
