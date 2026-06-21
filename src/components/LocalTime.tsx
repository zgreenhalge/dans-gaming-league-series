'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const getServerSnapshot = () => false;
const getClientSnapshot = () => true;

export function LocalTime({
  iso,
  opts,
}: {
  iso: string;
  opts?: Intl.DateTimeFormatOptions;
}) {
  const isClient = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  if (!isClient) return null;

  const formatted = new Date(iso).toLocaleString(
    'en-US',
    opts ?? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
  );
  return <span>{formatted}</span>;
}
