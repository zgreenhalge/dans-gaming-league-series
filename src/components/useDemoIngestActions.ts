'use client';

// Shared demo-ingest actions for a match (#136 console + the in-match review block). One place for
// the confirm / dismiss / re-parse fetches so the match page (MatchDemoReviewBlock) and the admin
// dashboard (IngestJobActions) can't drift. Callers own their own refresh via `onSuccess`.

import { useCallback, useState } from 'react';
import type { DemoConfirmPayload } from '@/lib/demo/ingestResult';
import { routeError } from '@/lib/util';

interface Options {
  /** Called after any action succeeds — e.g. `router.refresh()` and/or clearing local state. */
  onSuccess?: () => void;
}

export function useDemoIngestActions(matchId: number, opts: Options = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { onSuccess } = opts;

  // Run an action; the fn returns an error message string, or null on success.
  const run = useCallback(
    async (fn: () => Promise<string | null>): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const err = await fn();
        if (err) {
          setError(err);
          return false;
        }
        onSuccess?.();
        return true;
      } catch (e) {
        // Network/unexpected failure — surface it instead of a silent unhandled rejection.
        setError(e instanceof Error ? e.message : 'Something went wrong');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onSuccess],
  );

  /** Clear the staged artifact and record the job's disposition — an error message, or null. */
  const clearResult = useCallback(
    async (disposition: 'confirmed' | 'dismissed'): Promise<string | null> => {
      const res = await fetch(`/api/matches/${matchId}/demo/result?disposition=${disposition}`, { method: 'DELETE' });
      return res.ok ? null : routeError(res, 'Could not clear the parsed result');
    },
    [matchId],
  );

  /** Write the staged score, then clear the staged artifact. `payload` avoids a refetch when the
   *  caller already has it (the match page does); otherwise the staged result is fetched first. */
  const confirm = useCallback(
    (payload?: DemoConfirmPayload | null, warnings?: string[]) =>
      run(async () => {
        let p = payload ?? null;
        let w = warnings ?? null;
        // Fetch the staged result if the caller didn't hand us the payload/warnings (dashboard rows).
        if (!p || !w) {
          const r = await fetch(`/api/matches/${matchId}/demo/result`);
          if (!r.ok) return routeError(r, 'Could not load the parsed result');
          const j = (await r.json()) as { result?: { payload?: DemoConfirmPayload | null; warnings?: string[] } };
          p = p ?? j?.result?.payload ?? null;
          w = w ?? j?.result?.warnings ?? null;
        }
        if (!p) return 'No derivable score to confirm — re-parse or enter the score manually.';
        const res = await fetch(`/api/matches/${matchId}/score`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          // Forward warnings so the score route can learn steam ids from elimination matches.
          body: JSON.stringify({ ...p, warnings: w ?? [] }),
        });
        if (!res.ok) return routeError(res, 'Could not save the score');
        const cleared = await clearResult('confirmed');
        return cleared && `Score saved, but clearing the parsed result failed: ${cleared}`;
      }),
    [matchId, run, clearResult],
  );

  const dismiss = useCallback(
    () =>
      run(async () => {
        return clearResult('dismissed');
      }),
    [run, clearResult],
  );

  /** Re-dispatch the demo-ingest Action (parse again from the demo already in R2). */
  const retry = useCallback(
    () =>
      run(async () => {
        const res = await fetch(`/api/matches/${matchId}/demo/dispatch`, { method: 'POST' });
        if (!res.ok) return routeError(res, 'Could not start a re-parse');
        return null;
      }),
    [matchId, run],
  );

  return { confirm, dismiss, retry, busy, error };
}
