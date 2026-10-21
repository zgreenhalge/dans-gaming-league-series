import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { getAdminClient } from '../supabase-admin';

// The persistent read cache. A `persistentQuery()` read is stored in Next's data cache, which outlives
// a single request, under a key that includes `data_version.version` (see
// supabase/migrations/20261021120000_add_data_version.sql): every content write bumps that counter,
// so a write — from any writer — leaves the old entries unreachable and the next read recomputes.
// The TTL below only lets unreferenced entries expire.

const CACHE_TTL_SECONDS = 24 * 60 * 60;

/** PostgREST / Postgres codes for a missing `data_version` table: not in the schema cache, undefined table. */
const MISSING_TABLE_CODES = new Set(['PGRST205', '42P01']);

let warnedMissingTable = false;

/**
 * The current content version — one tiny read per request, shared by every persistent read in it
 * (during a render; a route handler has no render scope, so each read there fetches the version
 * itself and sees the writes the handler already made). `null` while the `data_version` migration
 * hasn't been applied: reads then go straight to the database, the always-fresh direction, so code
 * deployed ahead of the migration keeps working; the missing table is logged.
 */
const getDataVersion = cache(async (): Promise<number | null> => {
  const { data, error } = await getAdminClient().from('data_version').select('version').eq('id', 1).single();
  if (error) {
    if (!MISSING_TABLE_CODES.has(error.code)) throw error;
    if (!warnedMissingTable) {
      warnedMissingTable = true;
      console.error('data_version table is missing: apply migration 20261021120000_add_data_version.sql; reads are uncached until then');
    }
    return null;
  }
  if (!data) throw new Error('data_version has no row');
  return Number(data.version);
});

/** `value` as a string `JSON.parse` can turn back into an equal value, `Map`s and `Set`s included —
 *  the data cache stores JSON, which has neither. `undefined` has no JSON form, so it is rejected. */
export function encodeCacheValue(value: unknown): string {
  const encoded = JSON.stringify(value, (_key, v) =>
    v instanceof Map ? { __type: 'Map', entries: [...v] } : v instanceof Set ? { __type: 'Set', values: [...v] } : v,
  );
  if (encoded === undefined) throw new Error('persistentQuery: a read returned undefined, which cannot be cached');
  return encoded;
}

export function decodeCacheValue<T>(encoded: string): T {
  return JSON.parse(encoded, (_key, v) =>
    v?.__type === 'Map' ? new Map(v.entries) : v?.__type === 'Set' ? new Set(v.values) : v,
  ) as T;
}

/** Whether this code runs inside Next (a request, a build or the dev server), the only place the
 *  data cache exists. Scripts, GitHub Actions and tests read straight from the database. */
function runsUnderNext(): boolean {
  return process.env.NEXT_RUNTIME !== undefined;
}

/**
 * `cache()` for a read of shared, user-independent data, persisted across requests (see the top of
 * this file) as well as deduplicated within one. `name` identifies the read in the cache. Arguments
 * must be plain values (they become part of the key): a call passing an object — a Supabase `client`,
 * say — reads straight from the database, as does any call outside Next.
 *
 * Results survive a JSON round trip, so a read returns `Map`s, `Set`s and plain data (no class
 * instances, `Date`s or `undefined` fields) — which is what the cached read hands back too.
 */
export function persistentQuery<A extends unknown[], R>(
  name: string,
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return cache(async (...args: A): Promise<R> => {
    let end = args.length;
    while (end > 0 && args[end - 1] === undefined) end--;
    const keyArgs = args.slice(0, end) as A;
    if (!runsUnderNext() || keyArgs.some((a) => typeof a === 'object' && a !== null)) return fn(...args);

    const version = await getDataVersion();
    if (version === null) return fn(...args);
    const read = unstable_cache(async (...a: A) => encodeCacheValue(await fn(...a)), [name, String(version)], {
      revalidate: CACHE_TTL_SECONDS,
    });
    return decodeCacheValue<R>(await read(...keyArgs));
  });
}
