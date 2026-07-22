'use client';

// Single shared poll of `GET /api/scrim/status`, consumed by both `ScrimNavStatus` (the sidebar's
// live-scrim dot, mounted on every page via `SideNav`) and `ScrimPanel` (the `/scrim` page itself) so
// the two don't independently run their own fetch/interval loops for the same data. Polls at the
// nav's cadence by default; a mounted `ScrimPanel` calls `requestFastPoll` to speed the shared
// interval up for as long as it's on screen, and reverts it once unmounted. Only polls for signed-in
// players, since the endpoint is session-gated.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import type { ScrimStatus } from '@/app/api/scrim/status/route';

const NAV_POLL_MS = 15_000;
const FAST_POLL_MS = 3_000;

interface ScrimStatusContextValue {
  status: ScrimStatus | null;
  error: string | null;
  refresh: () => Promise<void>;
  requestFastPoll: (fast: boolean) => void;
}

const ScrimStatusContext = createContext<ScrimStatusContextValue | null>(null);

export function ScrimStatusProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const signedIn = !!session?.user?.playerId;
  const [status, setStatus] = useState<ScrimStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fastPoll, setFastPoll] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/scrim/status');
      if (!res.ok) {
        setError('Could not load server status');
        return;
      }
      setStatus((await res.json()) as ScrimStatus);
      setError(null);
    } catch {
      setError('Could not load server status');
    }
  }, []);

  const requestFastPoll = useCallback((fast: boolean) => setFastPoll(fast), []);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    (async () => {
      if (!cancelled) await refresh();
    })();
    const interval = setInterval(refresh, fastPoll ? FAST_POLL_MS : NAV_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [signedIn, fastPoll, refresh]);

  const value = useMemo(
    () => ({ status, error, refresh, requestFastPoll }),
    [status, error, refresh, requestFastPoll],
  );

  return <ScrimStatusContext.Provider value={value}>{children}</ScrimStatusContext.Provider>;
}

export function useScrimStatus(): ScrimStatusContextValue {
  const ctx = useContext(ScrimStatusContext);
  if (!ctx) throw new Error('useScrimStatus must be used inside ScrimStatusProvider');
  return ctx;
}
