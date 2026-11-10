/**
 * Thin wrapper around Vitest's `test()` so every `src/lib/**\/*.test.ts` file (discovered by
 * `npm test`'s `vitest run`) keeps its existing `test(name, fn)` / `report()` call shape.
 */

import { test as vitestTest } from 'vitest';

/** `timeoutMs` overrides Vitest's per-test timeout for a test whose work is genuinely long. */
export function test(name: string, fn: () => void | Promise<void>, timeoutMs?: number): void {
  vitestTest(name, fn, timeoutMs);
}

export function report(): void {}
