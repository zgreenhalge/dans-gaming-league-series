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

  test('a client-like argument reads straight from the database', async () => {
    class FakeClient {}
    const read = vi.fn(async (...args: [object?]) => args.length);
    await persistentQuery('client', read)(new FakeClient());
    await persistentQuery('client', read)(new FakeClient());
    expect(read).toHaveBeenCalledTimes(2);
    expect(store.size).toBe(0);
  });

  test('trailing undefined arguments are dropped before the function and the key', async () => {
    const read = vi.fn(async (...args: unknown[]) => args.length);
    const cached = persistentQuery('trim', read);
    await cached(1, undefined);
    await cached(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(1);
  });

  test('plain-data arguments (options objects, arrays) are part of the key', async () => {
    const read = vi.fn(async (_id: number, opts?: { week?: number }, ids?: number[]) => [opts, ids]);
    const cached = persistentQuery('plain', read);
    await cached(1, { week: 2 }, [3]);
    await cached(1, { week: 2 }, [3]);
    await cached(1, { week: 3 }, [3]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  test('outside Next the read bypasses the cache and the version read', async () => {
    vi.unstubAllEnvs();
    db.data_version = [];
    const read = vi.fn(async () => 1);
    await persistentQuery('bypass', read)();
    expect(read).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(0);
  });

  test.each([
    ['a missing table', { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.data_version'" } }],
    ['a failed read', { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }],
    ['a table with no row', { data: null, error: null }],
  ])('%s reads straight from the database and logs', async (_label, result) => {
    __setTestAdminClient({
      from: () => ({ select: () => ({ eq: () => ({ single: async () => result }) }) }),
    } as never);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const read = vi.fn(async () => 1);
    await persistentQuery('unreadable', read)();
    await persistentQuery('unreadable', read)();
    expect(read).toHaveBeenCalledTimes(2);
    expect(store.size).toBe(0);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('encodeCacheValue / decodeCacheValue', () => {
  test('round-trips nested Maps and Sets', () => {
    const value = new Map<number, Map<string, Set<number>>>([[1, new Map([['a', new Set([1])]])]]);
    expect(decodeCacheValue(encodeCacheValue(value))).toEqual(value);
  });

  test('round-trips undefined, NaN and ±Infinity, nested or not', () => {
    const value = { a: [1, undefined, NaN], b: new Map([[1, Infinity], [2, -Infinity]]), c: undefined };
    const out = decodeCacheValue<typeof value>(encodeCacheValue(value));
    expect(out.a[1]).toBeUndefined();
    expect(out.a[2]).toBeNaN();
    expect(out.b.get(1)).toBe(Infinity);
    expect(out.b.get(2)).toBe(-Infinity);
    expect(decodeCacheValue(encodeCacheValue(undefined))).toBeUndefined();
  });

  test('a plain object keeps its own keys, even one named like a Map', () => {
    const value = { __type: 'Map', entries: [[1, 2]] };
    expect(decodeCacheValue(encodeCacheValue(value))).toEqual(value);
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
    ['getOpenFeedbackSeasonIds', () => q.getOpenFeedbackSeasonIds()],
    ['getSurveyForSeason(1)', () => q.getSurveyForSeason(1)],
    ['getSuperlativePoll(1)', () => q.getSuperlativePoll(1)],
    ['getSeasonPlayedPlayers(1)', () => q.getSeasonPlayedPlayers(1)],
  ];

  test.each(reads)('%s', async (_name, read) => {
    __setTestAdminClient(createFakeSupabaseClient(buildFakeDb()));
    vi.unstubAllEnvs();
    const uncached = await read();
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    expect(await read()).toEqual(uncached);
  });
});
