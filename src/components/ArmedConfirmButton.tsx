'use client';

// Shared arm -> confirm/cancel control for a destructive or one-way admin action (delete, reset,
// go-live) — the exact same two-state shape and Tailwind classes were independently duplicated across
// DeleteSeasonButton, MarkSeasonActiveButton, and GauntletLifecycleList's reset control. The caller
// owns the actual mutation (`onConfirm`) plus its own `armed`/`busy`/`error` state, since each
// caller's request/response handling differs too much to generalize (warnings, redirects, retries) —
// this only extracts the interaction shape and styling, not the mutation logic.

const CONFIRM_VARIANT: Record<'primary' | 'danger', string> = {
  primary: 'border-[var(--color-accent-green-border)] bg-[var(--color-accent-green-bg)] text-[var(--color-accent-green-fg)]',
  danger: 'border-[var(--color-accent-red-border)] bg-[var(--color-accent-red-bg)] text-[var(--color-accent-red-fg)]',
};

/** The primary admin submit button (form CTAs like "Create Season" or "Confirm & Build") — shares
 * `CONFIRM_VARIANT.primary`'s green scheme at the larger size those forms use. Append layout
 * modifiers (`self-start`, `disabled:opacity-40`) at the call site. */
export const ADMIN_PRIMARY_BUTTON_CLS =
  'tracked text-[11px] font-semibold px-4 py-2.5 border border-[var(--color-accent-green-border)] text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] hover:brightness-110 transition-all';

const TRIGGER_STYLE: Record<'bordered' | 'link', string> = {
  bordered:
    'tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors',
  link: 'font-mono text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-red-fg)] transition-colors underline decoration-dotted',
};

export function ArmedConfirmButton({
  armed,
  onArm,
  onCancel,
  onConfirm,
  busy,
  error,
  triggerLabel,
  triggerStyle = 'bordered',
  confirmLabel,
  busyLabel,
  variant,
}: {
  armed: boolean;
  onArm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
  error?: string | null;
  triggerLabel: string;
  triggerStyle?: 'bordered' | 'link';
  confirmLabel: string;
  busyLabel: string;
  variant: 'primary' | 'danger';
}) {
  return (
    <div className="flex items-center gap-2">
      {armed ? (
        <>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`tracked text-[10px] font-semibold px-2 py-1 border hover:brightness-110 transition-all disabled:opacity-40 ${CONFIRM_VARIANT[variant]}`}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
          <button
            onClick={onCancel}
            disabled={busy}
            className="font-mono text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            Cancel
          </button>
        </>
      ) : (
        <button onClick={onArm} className={TRIGGER_STYLE[triggerStyle]}>
          {triggerLabel}
        </button>
      )}
      {error && <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)]">{error}</div>}
    </div>
  );
}
