/**
 * Tests for `loadPanel`: a resolved read wraps as data, a rejected one becomes an error message
 * (from an `Error`, a Supabase-style `{ message }` object, or anything else) rather than throwing.
 * Run: npx vitest run src/lib/panel-load.test.ts
 */

import { describe, expect, test, vi } from 'vitest';
import { redirect } from 'next/navigation';
import { loadPanel } from './panel-load';

describe('loadPanel', () => {
  test('a resolved read wraps as { ok: true, data }', async () => {
    expect(await loadPanel('players', async () => [1, 2])).toEqual({ ok: true, data: [1, 2] });
  });

  test('a rejected read becomes { ok: false, error } and is logged', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await loadPanel('players', () => Promise.reject(new Error('boom')))).toEqual({ ok: false, error: 'boom' });
      expect(await loadPanel('players', () => Promise.reject({ code: 'X', message: 'connection reset' }))).toEqual({
        ok: false,
        error: 'connection reset',
      });
      expect(await loadPanel('players', () => Promise.reject('plain'))).toEqual({ ok: false, error: 'plain' });
      expect(log).toHaveBeenCalledTimes(3);
    } finally {
      log.mockRestore();
    }
  });

  test('a Next.js control-flow error (redirect) is rethrown, not wrapped', async () => {
    await expect(loadPanel('players', async () => redirect('/'))).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    });
  });
});
