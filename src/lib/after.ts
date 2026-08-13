// Shared "fire in after(), log-not-throw" wrapper for best-effort post-response side effects — the
// shape every API route in this repo uses for work that shouldn't block or fail the response it rides
// in on (server provisioning/teardown, demo-pipeline dispatch, MatchZy event bookkeeping).

import { after } from 'next/server';

// `after()` throws synchronously when called outside a real Next.js request scope, which a
// route-handler test invoking an exported handler directly (see test-support/nextRequest.ts) never
// has. `__setTestAfterMode(true)` swaps the runner for one that queues the deferred work instead of
// calling the real `after()`; a test then awaits `__flushTestAfter()` once the handler returns, to
// run that work to completion (including its onError path) before asserting on its effects — the
// same "let the deferred work actually happen, deterministically" need every route using
// afterBestEffort() has under test. `__setTestAfterMode(false)` (or never calling it) restores real
// `after()` behavior. Not used by application code.
let testQueue: (() => Promise<void>)[] | null = null;

export function __setTestAfterMode(enabled: boolean): void {
  testQueue = enabled ? [] : null;
}

/** Runs every currently-queued deferred callback to completion (including its onError handling) and
 * clears the queue. A no-op if `__setTestAfterMode(true)` was never called. */
export async function __flushTestAfter(): Promise<void> {
  if (!testQueue) return;
  const queue = testQueue;
  testQueue = [];
  await Promise.all(queue.map((fn) => fn()));
}

/** Runs `fn` in `after()`, awaiting `onError` (default: `console.error(`${label} failed:`, err)`) if
 *  it rejects instead of letting the rejection escape. Pass a custom `onError` when a caller needs to
 *  distinguish an expected failure (e.g. a race-loser error) from a real one, or needs to run other
 *  cleanup alongside logging. */
export function afterBestEffort(
  label: string,
  fn: () => Promise<unknown>,
  onError: (err: unknown) => void | Promise<void> = (err) => console.error(`${label} failed:`, err),
): void {
  const run = async () => {
    try {
      await fn();
    } catch (err) {
      await onError(err);
    }
  };
  if (testQueue) {
    testQueue.push(run);
  } else {
    after(run);
  }
}
