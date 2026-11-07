'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Re-renders the server page once `iso` arrives, so what depends on the clock (a button that appears
 *  at a set time) shows up without the viewer reloading. Renders nothing. */
export function RefreshAt({ iso }: { iso: string }) {
  const router = useRouter();
  useEffect(() => {
    // setTimeout can't wait longer than ~24.8 days; a farther time just never fires here.
    const delay = Date.parse(iso) - Date.now();
    if (delay > 2 ** 31 - 1) return;
    const id = setTimeout(() => router.refresh(), Math.max(delay, 0) + 500);
    return () => clearTimeout(id);
  }, [iso, router]);
  return null;
}
