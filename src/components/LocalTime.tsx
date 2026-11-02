'use client';

import { useHasMounted } from './useHasMounted';

export function LocalTime({
  iso,
  opts,
  fallback = null,
}: {
  iso: string;
  opts?: Intl.DateTimeFormatOptions;
  /** Rendered on the server and before hydration, when the viewer's timezone isn't known yet. */
  fallback?: string | null;
}) {
  const isClient = useHasMounted();
  if (!isClient) return fallback;

  const formatted = new Date(iso).toLocaleString(
    'en-US',
    opts ?? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
  );
  return <span>{formatted}</span>;
}
