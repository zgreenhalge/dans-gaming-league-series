/**
 * Thin wrapper around Vitest's `test()` so every `src/lib/**\/*.test.ts` file (discovered by
 * `npm test`'s `vitest run`) keeps its existing `test(name, fn)` / `report()` call shape.
 */

import { test as vitestTest } from 'vitest';

export function test(name: string, fn: () => void | Promise<void>): void {
  vitestTest(name, fn);
}

export function report(): void {}
