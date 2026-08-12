// Shared rendering for the schedule-collision / week-window warning driven by `useScheduleEditor`
// (#134 shared-server collisions, #144 admin console). `ScheduleCollisionMessage` is the "within an
// hour of X" copy used by the overlap banner and the warning box alike. `ScheduleWarningBox` adds the
// "Schedule anyway" / "Cancel" actions used by the console (compact) and the match-page hero (hero) —
// `variant` only switches chrome, never copy or behavior.
//
// No 'use client' here: neither component uses hooks, so each stays server-safe when rendered from
// `SchedulingOverlapBanner` and client-safe when rendered from an already-client parent.

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { ScheduledMatchRef } from '@/lib/schedule';
import type { ScheduleWarning } from './useScheduleEditor';

export function ScheduleCollisionMessage({
  match,
  leadIn = 'Within an hour of',
}: {
  match: ScheduledMatchRef | null;
  leadIn?: string;
}) {
  return (
    <>
      {leadIn}{' '}
      {match ? (
        <Link href={`/matches/${match.id}`} className="underline hover:opacity-80">
          {match.label}
        </Link>
      ) : (
        'another match'
      )}
      .
    </>
  );
}

const VARIANT_STYLES = {
  compact: {
    box: 'border border-[var(--color-accent-amber-border)] bg-[var(--color-accent-amber-bg)] px-3 py-2 flex flex-col gap-2 rounded',
    text: 'font-mono text-[11px] text-[var(--color-accent-amber-fg)]',
    primaryButton:
      'font-mono text-[10px] font-semibold px-2 py-1 rounded border border-[var(--color-accent-amber-border)] text-[var(--color-accent-amber-fg)] transition-colors',
    secondaryButton:
      'font-mono text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors',
  },
  hero: {
    box: 'border border-[var(--color-accent-amber-border)] bg-[var(--color-accent-amber-bg)] px-3 py-2.5 flex flex-col gap-2',
    text: 'text-[12px] text-[var(--color-accent-amber-fg)]',
    primaryButton:
      'tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-accent-amber-border)] text-[var(--color-accent-amber-fg)] transition-colors',
    secondaryButton:
      'tracked text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors',
  },
} as const;

export function ScheduleWarningBox({
  warning,
  collisionWith,
  windowMessage,
  onScheduleAnyway,
  onDismiss,
  variant,
}: {
  warning: ScheduleWarning;
  collisionWith: ScheduledMatchRef | null;
  windowMessage: ReactNode;
  onScheduleAnyway: () => void;
  onDismiss: () => void;
  variant: keyof typeof VARIANT_STYLES;
}) {
  if (!warning) return null;
  const styles = VARIANT_STYLES[variant];

  return (
    <div className={styles.box}>
      <span className={styles.text}>
        {warning === 'collision' ? <ScheduleCollisionMessage match={collisionWith} /> : windowMessage}
      </span>
      <div className="flex items-center justify-end gap-3">
        <button onClick={onScheduleAnyway} className={styles.primaryButton}>
          Schedule anyway
        </button>
        <button onClick={onDismiss} className={styles.secondaryButton}>
          Cancel
        </button>
      </div>
    </div>
  );
}
