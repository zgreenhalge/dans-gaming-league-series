'use client';

// Shared button-sized spinner for in-flight server actions, used by MatchServerPanel (per-match
// provisioning) and ServerConsolePanel (admin start/stop). DatHost gives us no real progress and the
// timing is inconsistent, so it's a plain indeterminate spinner — kept here so both call sites
// inherit the same look and feel. `tone` colors it green for start-ish actions, red for stop.

import { Loader2 } from 'lucide-react';

const TONES = {
  start: 'border-green-500/70 bg-green-600/10',
  stop: 'border-red-500/70 bg-red-600/10',
} as const;

export function ServerSpinner({ label, tone = 'start' }: { label: string; tone?: keyof typeof TONES }) {
  return (
    <div
      className={`flex h-9 w-full items-center justify-center gap-2 rounded-md border text-sm font-semibold text-[var(--color-text-primary)] ${TONES[tone]}`}
    >
      <Loader2 size={16} className="animate-spin" />
      {label}
    </div>
  );
}
