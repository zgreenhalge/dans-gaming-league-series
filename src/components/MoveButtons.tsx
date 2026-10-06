'use client';

// Up/down arrow buttons for moving a row within an ordered list (survey questions, superlatives).

import { ChevronDown, ChevronUp } from 'lucide-react';

/** A copy of `items` with the entry at `from` moved to index `to`. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

const BTN_CLS = 'shrink-0 p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-30';

export function MoveButtons({ index, count, disabled, onMove }: { index: number; count: number; disabled?: boolean; onMove: (to: number) => void }) {
  return (
    <span className="flex shrink-0">
      <button type="button" onClick={() => onMove(index - 1)} disabled={disabled || index === 0} aria-label="Move up" title="Move up" className={BTN_CLS}>
        <ChevronUp size={16} aria-hidden />
      </button>
      <button type="button" onClick={() => onMove(index + 1)} disabled={disabled || index === count - 1} aria-label="Move down" title="Move down" className={BTN_CLS}>
        <ChevronDown size={16} aria-hidden />
      </button>
    </span>
  );
}
