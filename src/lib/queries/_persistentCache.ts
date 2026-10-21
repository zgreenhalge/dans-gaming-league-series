import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { getAdminClient } from '../supabase-admin';

// The persistent read cache. A `persistentQuery()` read is stored in Next's data cache, which outlives
// a single request, under a key that includes `data_version.version` (see
// supabase/migrations/20261021120000_add_data_version.sql): every content write bumps that counter,
// so a write — from any writer — leaves the old entries unreachable and the next read recomputes.
// The TTL below only lets unreferenced entries expire. Each entry is capped by the data cache's item
// size limit (about 2 MB); a larger result is simply not stored and is recomputed on every read.

const CACHE_TTL_SECONDS = 24 * 60 * 60;

let lastVersionError: string | undefined;

/**
 * The current content version — one tiny read per request, shared by every persistent read in it
 * (during a render; a route handler has no render scope, so each read there fetches the version
 * itself and sees the writes the handler already made). `null` when the version can't be read — the
 * `data_version` migration isn't applied, or the read failed: reads then go straight to the database,
 * the always-fresh direction, and the failure is logged (once per distinct message).
 */
const getDataVersion = cache(async (): Promise<number | null> => {
  const { data, error } = await getAdminClient().from('data_version').select('version').eq('id', 1).single();
  const failure = error ? error.message : data ? null : 'no row';
  if (failure === null) return Number(data!.version);
  if (failure !== lastVersionError) {
    lastVersionError = failure;
    console.error(`data_version unreadable (${failure}); persistent reads run uncached until it is`);
  }
  return null;
});

/** Marks the values JSON has no form for. A plain object never has this key. */
const TAG = '__dglsCache';

/** `value` as a string `JSON.parse` turns back into an equal value: `Map`s, `Set`s, `undefined`, `NaN`
 *  and `±Infinity` — which the data cache's JSON storage would otherwise drop or turn into `null`. */
export function encodeCacheValue(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v instanceof Map) return { [TAG]: 'Map', entries: [...v] };
    if (v instanceof Set) return { [TAG]: 'Set', values: [...v] };
    if (v === undefined) return { [TAG]: 'undefined' };
    if (typeof v === 'number' && !Number.isFinite(v)) return { [TAG]: 'number', value: String(v) };
    return v;
  });
}

export function decodeCacheValue<T>(encoded: string): T {
  return JSON.parse(encoded, (_key, v) => {
    switch (v?.[TAG]) {
      case 'Map': return new Map(v.entries);
      case 'Set': return new Set(v.values);
      case 'undefined': return undefined;
      case 'number': return Number(v.value);
      default: return v;
    }
  }) as T;
}

/** Whether `value` survives being part of a cache key: primitives, arrays and plain objects of them.
 *  A `SupabaseClient`, a `Map` or a `Promise` does not. */
function isCacheKeyable(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return true;
  if (Array.isArray(value)) return value.every(isCacheKeyable);
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) && Object.values(value).every(isCacheKeyable);
}

/** Whether this code runs inside Next (a request, a build or the dev server), the only place the
 *  data cache exists. Scripts, GitHub Actions and tests read straight from the database. */
function runsUnderNext(): boolean {
  return process.env.NEXT_RUNTIME !== undefined;
}

/**
 * `cache()` for a read of shared, user-independent data, persisted across requests (see the top of
 * this file) as well as deduplicated within one. `name` identifies the read in the cache. Arguments
 * are part of the key, so they must be plain data: a call passing a Supabase `client`, a `Map` or a
 * `Promise` reads straight from the database, as does any call outside Next.
 *
 * Results survive a round trip through `encodeCacheValue()`, so a cached read hands back what the
 * uncached one does: plain data, `Map`s and `Set`s (not class instances or `Date`s).
 */
export function persistentQuery<A extends unknown[], R>(
  name: string,
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return cache(async (...args: A): Promise<R> => {
    let end = args.length;
    while (end > 0 && args[end - 1] === undefined) end--;
    const keyArgs = args.slice(0, end) as A;
    if (!runsUnderNext() || !keyArgs.every(isCacheKeyable)) return fn(...args);

    const version = await getDataVersion();
    if (version === null) return fn(...args);
    const read = unstable_cache(async (...a: A) => encodeCacheValue(await fn(...a)), [name, String(version)], {
      revalidate: CACHE_TTL_SECONDS,
    });
    return decodeCacheValue<R>(await read(...keyArgs));
  });
}
