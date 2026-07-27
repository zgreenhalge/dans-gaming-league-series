// Shared "fire in after(), log-not-throw" wrapper for best-effort post-response side effects — the
// shape every API route in this repo uses for work that shouldn't block or fail the response it rides
// in on (server provisioning/teardown, demo-pipeline dispatch, MatchZy event bookkeeping).

import { after } from 'next/server';

/** Runs `fn` in `after()`, awaiting `onError` (default: `console.error(`${label} failed:`, err)`) if
 *  it rejects instead of letting the rejection escape. Pass a custom `onError` when a caller needs to
 *  distinguish an expected failure (e.g. a race-loser error) from a real one, or needs to run other
 *  cleanup alongside logging. */
export function afterBestEffort(
  label: string,
  fn: () => Promise<unknown>,
  onError: (err: unknown) => void | Promise<void> = (err) => console.error(`${label} failed:`, err),
): void {
  after(async () => {
    try {
      await fn();
    } catch (err) {
      await onError(err);
    }
  });
}
