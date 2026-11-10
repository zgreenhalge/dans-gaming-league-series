'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** How long after `iso` the refresh fires, so the server's own clock is past the boundary too. */
const SETTLE_MS = 500;

/** The longest delay `setTimeout` takes (~24.8 days); a longer one would fire at once. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** Re-renders the server page once `iso` arrives, so what depends on the clock (a button that appears
 *  at a set time) shows up without the viewer reloading. The page passes its next boundary
 *  (`nextRefreshInstant()`, `src/lib/util.ts`), and after the refresh renders a new `iso` for the one
 *  after it. A refresh that hands back the same `iso` doesn't re-arm the timer, so a client clock
 *  ahead of the server's can't loop. Renders nothing. */
export function RefreshAt({ iso }: { iso: string }) {
  const router = useRouter();
  useEffect(() => {
    const delay = Math.max(Date.parse(iso) - Date.now(), 0) + SETTLE_MS;
    // A time farther off than setTimeout can wait just never fires here.
    if (delay > MAX_TIMEOUT_MS) return;
    const id = setTimeout(() => router.refresh(), delay);
    return () => clearTimeout(id);
  }, [iso, router]);
  return null;
}
