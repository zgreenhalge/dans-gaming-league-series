/**
 * Unit tests for discord-webhook.ts's joinWithinLimit(): the text Discord accepts for a field or
 * message, cut with a "+N more" tail instead of being rejected.
 *
 * Run:  npx vitest run src/lib/discord-webhook.test.ts
 */

import assert from 'node:assert/strict';
import { joinWithinLimit } from './discord-webhook';
import { test, report } from './test-support/miniTest';

async function main() {
  await test('joinWithinLimit: returns everything when it fits', async () => {
    assert.equal(joinWithinLimit(['a', 'b', 'c'], 10), 'a\nb\nc');
    assert.equal(joinWithinLimit(['a', 'b'], 3, ' '), 'a b');
    assert.equal(joinWithinLimit([], 5), '');
  });

  await test('joinWithinLimit: keeps the lines that fit and counts the rest', async () => {
    const out = joinWithinLimit(['aaaa', 'bbbb', 'cccc', 'dddd'], 17);
    assert.equal(out, 'aaaa\nbbbb\n+2 more');
    assert.ok(out.length <= 17);
  });

  await test('joinWithinLimit: never exceeds the limit, even when one line is too long', async () => {
    assert.equal(joinWithinLimit(['x'.repeat(50), 'y'], 20), '+2 more');
    for (const max of [10, 25, 40]) assert.ok(joinWithinLimit(Array.from({ length: 30 }, (_, i) => `line ${i}`), max).length <= max);
  });

  report();
}

await main();
