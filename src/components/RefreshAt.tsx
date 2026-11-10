'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** How long after `iso` the refresh fires, so the server's own clock is past the boundary too. */
const SETTLE_MS = 500;

/** The longest delay `setTimeout` takes (~24.8 days); a longer one would fire at once. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** Re-renders the server page once `iso` arrives, so what depends on the clock (a button that appears
 *  at a set time) shows up without the viewer reloading. The page passes its next boundary
 *  (`nextRefreshInstant()`, `src/lib/util.ts`) and the `serverNow` (epoch ms) it rendered at, and after
 *  the refresh renders the boundary after it. The wait is measured from `serverNow`, never from the
 *  viewer's clock, so a device clock that runs fast can't fire it before the server has passed the
 *  boundary; the time the page took to arrive only makes it later. Renders nothing. */
export function RefreshAt({ iso, serverNow }: { iso: string; serverNow: number }) {
  const router = useRouter();
  useEffect(() => {
    const delay = Math.max(Date.parse(iso) - serverNow, 0) + SETTLE_MS;
    // A time farther off than setTimeout can wait just never fires here.
    if (delay > MAX_TIMEOUT_MS) return;
    const id = setTimeout(() => router.refresh(), delay);
    return () => clearTimeout(id);
  }, [iso, serverNow, router]);
  return null;
}
