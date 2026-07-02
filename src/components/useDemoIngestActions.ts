'use client';

// Shared demo-ingest actions for a match (#136 console + the in-match review block). One place for
// the confirm / dismiss / re-parse fetches so the match page (MatchDemoReviewBlock) and the admin
// dashboard (IngestJobActions) can't drift. Callers own their own refresh via `onSuccess`.

import { useCallback, useState } from 'react';
import type { DemoConfirmPayload } from '@/lib/demo/ingestResult';

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

  /** Write the staged score, then clear the staged artifact. `payload` avoids a refetch when the
   *  caller already has it (the match page does); otherwise the staged result is fetched first. */
  const confirm = useCallback(
    (payload?: DemoConfirmPayload | null) =>
      run(async () => {
        let p = payload ?? null;
        if (!p) {
          const r = await fetch(`/api/matches/${matchId}/demo/result`);
          if (r.ok) p = ((await r.json()) as { result?: { payload?: DemoConfirmPayload | null } })?.result?.payload ?? null;
        }
        if (!p) return 'No derivable score to confirm — re-parse or enter the score manually.';
        const res = await fetch(`/api/matches/${matchId}/score`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(p),
        });
        if (!res.ok) return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Could not save the score';
        await fetch(`/api/matches/${matchId}/demo/result?disposition=confirmed`, { method: 'DELETE' }).catch(() => {});
        return null;
      }),
    [matchId, run],
  );

  const dismiss = useCallback(
    () =>
      run(async () => {
        await fetch(`/api/matches/${matchId}/demo/result?disposition=dismissed`, { method: 'DELETE' }).catch(() => {});
        return null;
      }),
    [matchId, run],
  );

  /** Re-dispatch the demo-ingest Action (parse again from the demo already in R2). */
  const retry = useCallback(
    () =>
      run(async () => {
        const res = await fetch(`/api/matches/${matchId}/demo/dispatch`, { method: 'POST' });
        if (!res.ok) return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Could not start a re-parse';
        return null;
      }),
    [matchId, run],
  );

  return { confirm, dismiss, retry, busy, error };
}
