/**
 * Tests for `loadPanel`: a resolved read wraps as data, a rejected one becomes an error message
 * (from an `Error`, a Supabase-style `{ message }` object, or anything else) rather than throwing.
 * Run: npx vitest run src/lib/panel-load.test.ts
 */

import { describe, expect, test, vi } from 'vitest';
import { redirect } from 'next/navigation';
import { loadPanel, mapPanel } from './panel-load';

describe('loadPanel', () => {
  test('a resolved read wraps as { ok: true, data }', async () => {
    expect(await loadPanel('players', async () => [1, 2])).toEqual({ ok: true, data: [1, 2] });
  });

  test('a rejected read becomes { ok: false, error, label } and is logged under the label', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await loadPanel('players', () => Promise.reject(new Error('boom')))).toEqual({ ok: false, error: 'boom', label: 'players' });
      expect(await loadPanel('players', () => Promise.reject({ code: 'X', message: 'connection reset' }))).toEqual({
        ok: false,
        error: 'connection reset',
        label: 'players',
      });
      expect(await loadPanel('players', () => Promise.reject('plain'))).toEqual({ ok: false, error: 'plain', label: 'players' });
      expect(log).toHaveBeenCalledTimes(3);
      expect(log.mock.calls[0][0]).toBe('players failed to load:');
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

describe('mapPanel', () => {
  test('a loaded panel is derived from', () => {
    expect(mapPanel({ ok: true, data: [1, 2, 3] }, 'odds', (xs) => xs.filter((x) => x % 2))).toEqual({ ok: true, data: [1, 3] });
  });

  test('a failed panel keeps its error under the new label and never runs derive', () => {
    const derive = vi.fn();
    expect(mapPanel({ ok: false, error: 'boom', label: 'players' }, 'odds', derive)).toEqual({ ok: false, error: 'boom', label: 'odds' });
    expect(derive).not.toHaveBeenCalled();
  });
});
