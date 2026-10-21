/**
 * `persistentQuery()` (`queries/_persistentCache.ts`): the data-cache layer keyed by
 * `data_version.version`. `next/cache`'s `unstable_cache` is replaced by an in-memory stand-in that
 * keeps entries by key parts + arguments, which is the behaviour the helper relies on.
 *
 * Run:  npx vitest run src/lib/queries-persistent-cache.test.ts
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('next/cache', () => ({
  unstable_cache:
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>, keyParts: string[]) =>
    async (...args: A): Promise<R> => {
      const key = JSON.stringify([keyParts, args]);
      if (!store.has(key)) store.set(key, await fn(...args));
      return store.get(key) as R;
    },
}));

import { __setTestAdminClient } from './supabase-admin';
import { createFakeSupabaseClient, type FakeDb } from './test-support/fakeSupabase';
import { buildFakeDb } from './test-support/fixtures';
import { decodeCacheValue, encodeCacheValue, persistentQuery } from './queries/_persistentCache';
import * as q from './queries';

const db: FakeDb = { data_version: [{ id: 1, version: 1 }] };

beforeEach(() => {
  store.clear();
  db.data_version = [{ id: 1, version: 1 }];
  __setTestAdminClient(createFakeSupabaseClient(db));
  vi.stubEnv('NEXT_RUNTIME', 'nodejs');
});
afterEach(() => vi.unstubAllEnvs());

describe('persistentQuery', () => {
  test('a repeat read at the same version is served from the cache', async () => {
    const read = vi.fn(async (n: number) => ({ n }));
    expect(await persistentQuery('hit', read)(1)).toEqual({ n: 1 });
    expect(await persistentQuery('hit', read)(1)).toEqual({ n: 1 });
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('different arguments are different entries', async () => {
    const read = vi.fn(async (n: number) => n * 2);
    expect(await persistentQuery('args', read)(1)).toBe(2);
    expect(await persistentQuery('args', read)(2)).toBe(4);
    expect(read).toHaveBeenCalledTimes(2);
  });

  test('a bumped data_version recomputes the read', async () => {
    const read = vi.fn(async () => 'v');
    await persistentQuery('bump', read)();
    db.data_version[0].version = 2;
    await persistentQuery('bump', read)();
    expect(read).toHaveBeenCalledTimes(2);
  });

  test('Maps and Sets come back as Maps and Sets', async () => {
    const value = { byId: new Map([[1, new Set([2, 3])]]), list: [{ a: null }] };
    const out = await persistentQuery('shapes', async () => value)();
    expect(out).toEqual(value);
    expect(out.byId.get(1)).toBeInstanceOf(Set);
  });

  test('an object argument (a client) reads straight from the database', async () => {
    const read = vi.fn(async (...args: [object?]) => args.length);
    await persistentQuery('client', read)({});
    await persistentQuery('client', read)({});
    expect(read).toHaveBeenCalledTimes(2);
    expect(store.size).toBe(0);
  });

  test('outside Next the read bypasses the cache and the version read', async () => {
    vi.unstubAllEnvs();
    db.data_version = [];
    const read = vi.fn(async () => 1);
    await persistentQuery('bypass', read)();
    expect(read).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(0);
  });

  test('a missing data_version table reads straight from the database', async () => {
    const missing = { code: 'PGRST205', message: "Could not find the table 'public.data_version'" };
    __setTestAdminClient({
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: missing }) }) }) }),
    } as never);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const read = vi.fn(async () => 1);
    await persistentQuery('missing', read)();
    await persistentQuery('missing', read)();
    expect(read).toHaveBeenCalledTimes(2);
    expect(store.size).toBe(0);
    consoleError.mockRestore();
  });

  test('a data_version table with no row throws', async () => {
    db.data_version = [];
    await expect(persistentQuery('nover', async () => 1)()).rejects.toBeTruthy();
  });
});

describe('encodeCacheValue / decodeCacheValue', () => {
  test('round-trips nested Maps and Sets', () => {
    const value = new Map<number, Map<string, Set<number>>>([[1, new Map([['a', new Set([1])]])]]);
    expect(decodeCacheValue(encodeCacheValue(value))).toEqual(value);
  });

  test('rejects undefined', () => {
    expect(() => encodeCacheValue(undefined)).toThrow(/undefined/);
  });
});

// A cached read returns what the uncached read does: every wrapped read the pages rely on, run
// against the fixture league both ways.
describe('cached reads match uncached reads', () => {
  const reads: [string, () => Promise<unknown>][] = [
    ['getPlayersById', () => q.getPlayersById()],
    ['getSeasons', () => q.getSeasons()],
    ['getAllLeaderboards', () => q.getAllLeaderboards()],
    ['getCareerLeaderboard', () => q.getCareerLeaderboard()],
    ['getGauntletStats', () => q.getGauntletStats()],
    ['getAllSeasonMedalists', () => q.getAllSeasonMedalists()],
    ['getAllEhogSnapshots', () => q.getAllEhogSnapshots()],
    ['getStatisticsDetail', () => q.getStatisticsDetail()],
    ['getPlayer(1)', () => q.getPlayer(1)],
    ['getSeasonSchedule(1)', () => q.getSeasonSchedule(1)],
    ['getSeasonMatchSummaries(1)', () => q.getSeasonMatchSummaries(1)],
    ['getRegularSeasonLightView(1)', () => q.getRegularSeasonLightView(1, 1)],
    ['getCareerH2HDataCached', () => q.getCareerH2HDataCached()],
    ['getMatch(100)', () => q.getMatch(100)],
    ['getMapIndex', () => q.getMapIndex()],
  ];

  test.each(reads)('%s', async (_name, read) => {
    __setTestAdminClient(createFakeSupabaseClient(buildFakeDb()));
    vi.unstubAllEnvs();
    const uncached = await read();
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    expect(await read()).toEqual(uncached);
  });
});
