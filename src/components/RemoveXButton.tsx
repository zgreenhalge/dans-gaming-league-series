'use client';

// A red "X" icon button for removing a row (a custom survey question, a superlative) — compact next
// to the row's own content, with the action named in its accessible label and tooltip.

import { X } from 'lucide-react';

export function RemoveXButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="shrink-0 p-1 text-[var(--color-accent-red-fg)] hover:brightness-125 transition-all disabled:opacity-40"
    >
      <X size={16} strokeWidth={2.5} aria-hidden />
    </button>
  );
}
