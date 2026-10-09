import { describe, expect, test, vi } from 'vitest';

// `react`'s real cache() only memoizes inside a server render pass, so stand in a memoizer that keys
// on the exact argument list, as the real one does (`fn()` and `fn(undefined)` are different keys).
vi.mock('react', () => ({
  cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
    const memo = new Map<string, R>();
    return (...args: A): R => {
      const key = `${args.length}:${args.map(String).join(',')}`;
      if (!memo.has(key)) memo.set(key, fn(...args));
      return memo.get(key) as R;
    };
  },
}));

import { cacheQuery } from './queries/_shared';

describe('cacheQuery', () => {
  test('a trailing undefined argument shares the bare call entry', () => {
    const fn = vi.fn((a?: number, b?: string) => `${a}${b}`);
    const cached = cacheQuery(fn);
    cached();
    cached(undefined);
    cached(undefined, undefined);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('a defined argument gets its own entry; a leading undefined is kept', () => {
    const fn = vi.fn((a?: number, b?: string) => `${a}${b}`);
    const cached = cacheQuery(fn);
    cached();
    cached(undefined, 'x');
    cached(undefined, 'x');
    cached(1);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
