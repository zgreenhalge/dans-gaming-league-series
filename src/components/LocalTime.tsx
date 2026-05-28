'use client';

export function LocalTime({
  iso,
  opts,
}: {
  iso: string;
  opts?: Intl.DateTimeFormatOptions;
}) {
  const formatted = new Date(iso).toLocaleString(
    'en-US',
    opts ?? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
  );
  return <span suppressHydrationWarning>{formatted}</span>;
}
