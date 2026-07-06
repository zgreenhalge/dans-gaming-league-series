'use client';

import { useHasMounted } from './useHasMounted';

export function LocalTime({
  iso,
  opts,
}: {
  iso: string;
  opts?: Intl.DateTimeFormatOptions;
}) {
  const isClient = useHasMounted();
  if (!isClient) return null;

  const formatted = new Date(iso).toLocaleString(
    'en-US',
    opts ?? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
  );
  return <span>{formatted}</span>;
}
