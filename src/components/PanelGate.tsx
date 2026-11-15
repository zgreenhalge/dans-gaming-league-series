// Renders one admin panel from a `PanelData` (src/lib/panel-load.ts): the panel itself when its read
// succeeded, an inline error box when it failed — so one broken read leaves the other panels usable.

import type { ReactNode } from 'react';
import type { PanelData } from '@/lib/panel-load';
import ErrorText from './ErrorText';

export function PanelError({ label, error }: { label: string; error: string }) {
  return (
    <div role="alert" className="border border-[var(--color-accent-red-border)] bg-[var(--color-accent-red-bg)] rounded px-3 py-2.5">
      <div className="font-display text-[13px] font-semibold">Couldn&apos;t load {label}</div>
      <ErrorText error={error} className="mt-1 break-words" />
    </div>
  );
}

export function PanelGate<T>({
  label,
  panel,
  children,
}: {
  label: string;
  panel: PanelData<T>;
  children: (data: T) => ReactNode;
}) {
  return panel.ok ? <>{children(panel.data)}</> : <PanelError label={label} error={panel.error} />;
}
