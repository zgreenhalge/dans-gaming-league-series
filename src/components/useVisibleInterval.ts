'use client';

import { useEffect } from 'react';

/**
 * Calls `callback` every `ms` while the tab is visible, and once when a hidden tab becomes visible
 * again — the polling shape shared by the admin views that re-read server state on a timer
 * (`JobsLiveRefresh`, `ServerConsolePanel`). A hidden tab makes no calls. Pass a stable `callback`
 * (`useCallback`), or the interval restarts on every render.
 */
export function useVisibleInterval(callback: () => void, ms: number): void {
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) callback();
    };
    const interval = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [callback, ms]);
}
