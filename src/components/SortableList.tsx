'use client';

// A list whose rows are rearranged by dragging their grip handle (survey questions, superlatives).
// Built on pointer events so it works with a mouse and with touch: the handle captures the pointer,
// and the row under it is found from the pointer position.

import { useRef, useState, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';

/** A copy of `items` with the entry at `from` moved to index `to`. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

export function SortableList<T>({
  items,
  getKey,
  onReorder,
  disabled,
  renderRow,
  className,
}: {
  items: T[];
  getKey: (item: T, index: number) => string | number;
  /** Called with the full list in its new order when a drag ends on a different row. */
  onReorder: (next: T[]) => void;
  disabled?: boolean;
  /** Renders one row's content; place `handle` wherever the grip should sit. */
  renderRow: (item: T, index: number, handle: ReactNode) => ReactNode;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [from, setFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  function rowIndexAt(x: number, y: number): number | null {
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-sort-index]');
    if (!row || !listRef.current?.contains(row)) return null;
    return Number(row.dataset.sortIndex);
  }

  function endDrag(commit: boolean) {
    if (commit && from != null && over != null && from !== over) onReorder(moveItem(items, from, over));
    setFrom(null);
    setOver(null);
  }

  return (
    <div ref={listRef} className={className}>
      {items.map((item, i) => {
        const handle = (
          <span
            role="button"
            aria-label="Drag to reorder"
            title="Drag to reorder"
            onPointerDown={(e) => {
              if (disabled) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              setFrom(i);
              setOver(i);
            }}
            onPointerMove={(e) => {
              if (from == null) return;
              const index = rowIndexAt(e.clientX, e.clientY);
              if (index != null) setOver(index);
            }}
            onPointerUp={() => endDrag(true)}
            onPointerCancel={() => endDrag(false)}
            style={{ touchAction: 'none' }}
            className={`shrink-0 p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] ${
              disabled ? 'opacity-30' : from != null ? 'cursor-grabbing' : 'cursor-grab'
            }`}
          >
            <GripVertical size={16} aria-hidden />
          </span>
        );
        const dropTarget = from != null && over === i && from !== i;
        return (
          <div
            key={getKey(item, i)}
            data-sort-index={i}
            className={`${from === i ? 'opacity-50' : ''} ${dropTarget ? 'outline outline-2 outline-[var(--color-site-accent)]' : ''}`}
          >
            {renderRow(item, i, handle)}
          </div>
        );
      })}
    </div>
  );
}
