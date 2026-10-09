'use client';

import { useEffect } from 'react';

/**
 * Calls `callback` every `ms` while the tab is visible. A hidden tab makes no calls; when it becomes
 * visible again `callback` runs once and the interval restarts from there, so the next call is a
 * full `ms` later. Pass a stable `callback` (`useCallback`), or the interval restarts on every
 * render.
 */
export function useVisibleInterval(callback: () => void, ms: number): void {
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      interval = setInterval(callback, ms);
    };
    const onVisibilityChange = () => {
      clearInterval(interval);
      if (document.hidden) return;
      callback();
      start();
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [callback, ms]);
}
