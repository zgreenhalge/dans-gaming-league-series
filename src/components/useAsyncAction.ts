import { useCallback, useState } from 'react';

/**
 * The shared shape behind every admin/mutation button: track `busy` while an
 * async action runs, capture a thrown `Error`'s message as `error`, and clear
 * both on the next run. Callers do their own `fetch` + `if (!res.ok) throw` —
 * this only owns the busy/error bookkeeping around it.
 */
export function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, run };
}
