'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/** One entry in an `AdminMenu`. A one-click item has `onSelect`, which runs after the menu closes. An
 *  item with `content` expands in place of the item list instead: `content` is rendered with a `close`
 *  callback, for a picker or a small form whose own buttons finish the action. */
export interface AdminMenuItem {
  label: string;
  onSelect?: () => void;
  content?: (close: () => void) => ReactNode;
  disabled?: boolean;
  /** Red text, for a destructive action such as Remove. */
  danger?: boolean;
}

const ITEM_CLS =
  'block w-full text-left px-3 py-2 font-mono text-[11px] hover:bg-[var(--color-bg-secondary)] focus:bg-[var(--color-bg-secondary)] focus:outline-none transition-colors disabled:opacity-40 disabled:hover:bg-transparent';

/** An admin-only ⋯ button that opens a menu of actions, for a row or a section header. The caller
 *  renders it only for an admin. Escape, a click outside or focus leaving the menu closes it, and
 *  Escape or picking an item puts focus back on the button. Arrow keys move between items. */
export function AdminMenu({ label, items }: { label: string; items: AdminMenuItem[] }) {
  const [open, setOpen] = useState(false);
  // The item whose `content` is showing in place of the list, by index.
  const [expanded, setExpanded] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const triggerId = useId();

  function close(returnFocus = true) {
    setOpen(false);
    setExpanded(null);
    // By id, not a ref: `close` is handed to `content` during render.
    if (returnFocus) document.getElementById(triggerId)?.focus();
  }

  // A press anywhere outside the menu closes it, leaving focus where the press put it.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      setExpanded(null);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Opening, or expanding an item, moves focus to the first control inside.
  useEffect(() => {
    if (open) popupRef.current?.querySelector<HTMLElement>('button:not(:disabled), select, input')?.focus();
  }, [open, expanded]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (expanded != null || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const enabled = Array.from(popupRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
    if (enabled.length === 0) return;
    e.preventDefault();
    const at = enabled.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'Home' ? 0
      : e.key === 'End' ? enabled.length - 1
      : e.key === 'ArrowDown' ? (at + 1) % enabled.length
      : (at - 1 + enabled.length) % enabled.length;
    enabled[next].focus();
  }

  function pick(index: number) {
    const item = items[index];
    if (item.content) {
      setExpanded(index);
    } else {
      close();
      item.onSelect?.();
    }
  }

  const shown = expanded != null ? items[expanded] : null;

  return (
    <div
      ref={rootRef}
      className="relative shrink-0"
      onKeyDown={open ? onKeyDown : undefined}
      onBlur={(e) => {
        // Tabbing out closes it; a blur to nowhere (a press outside) is the pointerdown handler's.
        const to = e.relatedTarget as Node | null;
        if (open && to && !rootRef.current?.contains(to)) close(false);
      }}
    >
      <button
        id={triggerId}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className="px-2 py-0.5 font-mono text-[14px] leading-none text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] border border-transparent hover:border-[var(--color-border-primary)] transition-colors"
      >
        ⋯
      </button>
      {open && (
        <div
          ref={popupRef}
          className="absolute right-0 top-full mt-1 z-30 min-w-[10rem] max-w-[calc(100vw-2rem)] border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] shadow-lg"
        >
          {shown?.content ? (
            <div id={menuId} role="group" aria-label={shown.label} className="p-3 w-[18rem] max-w-full">
              {shown.content(close)}
            </div>
          ) : (
            <div id={menuId} role="menu" aria-label={label} className="py-1">
              {items.map((item, i) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => pick(i)}
                  className={`${ITEM_CLS} ${item.danger ? 'text-[var(--color-accent-red-fg,#f87171)]' : 'text-[var(--color-text-primary)]'}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
