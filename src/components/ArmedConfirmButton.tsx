'use client';

// Shared arm -> confirm/cancel control for a destructive or one-way action (delete, reset, go-live,
// end a scrim night). It owns the `armed` state: the trigger arms it, Cancel disarms it, and it
// disarms once `onConfirm`'s returned promise settles, whether the action succeeded or failed — a
// failure's `error` still shows beside the trigger. A caller that needs different arming passes
// `armed` (with `onArm`/`onCancel`) to control it instead. The caller owns the mutation itself
// (`onConfirm`) and its `busy`/`error` state, since each caller's request/response handling differs
// too much to generalize (warnings, redirects, retries).

import { useState } from 'react';
import { ADMIN_SMALL_BUTTON_CLS } from './adminButtonStyles';
import ErrorText from '@/components/ErrorText';

const CONFIRM_VARIANT: Record<'primary' | 'danger', string> = {
  primary: 'border-[var(--color-accent-green-border)] bg-[var(--color-accent-green-bg)] text-[var(--color-accent-green-fg)]',
  danger: 'border-[var(--color-accent-red-border)] bg-[var(--color-accent-red-bg)] text-[var(--color-accent-red-fg)]',
};

/** The standard single-line text input / select / textarea used by admin forms and player-facing
 * forms. */
export const FORM_INPUT_CLS =
  'font-mono text-[13px] px-3 py-2 border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-text-secondary)]';

const TRIGGER_STYLE: Record<'bordered' | 'link', string> = {
  bordered: ADMIN_SMALL_BUTTON_CLS,
  link: 'font-mono text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-red-fg)] transition-colors underline decoration-dotted',
};

/** Leave all three unset to let the button own its armed state, or pass all three to control it. */
type ArmedControl =
  | { armed: boolean; onArm: () => void; onCancel: () => void }
  | { armed?: undefined; onArm?: undefined; onCancel?: undefined };

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
}: ArmedControl & {
  onConfirm: () => void | Promise<unknown>;
  busy: boolean;
  error?: string | null;
  triggerLabel: string;
  triggerStyle?: 'bordered' | 'link';
  confirmLabel: string;
  busyLabel: string;
  variant: 'primary' | 'danger';
}) {
  const [ownArmed, setOwnArmed] = useState(false);
  const controlled = armed !== undefined;
  const isArmed = controlled ? armed : ownArmed;

  function arm() {
    if (!controlled) setOwnArmed(true);
    onArm?.();
  }

  function cancel() {
    if (!controlled) setOwnArmed(false);
    onCancel?.();
  }

  async function confirm() {
    try {
      await onConfirm();
    } finally {
      if (!controlled) setOwnArmed(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {isArmed ? (
        <>
          <button
            onClick={confirm}
            disabled={busy}
            className={`tracked text-[10px] font-semibold px-2 py-1 border hover:brightness-110 transition-all disabled:opacity-40 ${CONFIRM_VARIANT[variant]}`}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
          <button
            onClick={cancel}
            disabled={busy}
            className="font-mono text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            Cancel
          </button>
        </>
      ) : (
        <button onClick={arm} className={TRIGGER_STYLE[triggerStyle]}>
          {triggerLabel}
        </button>
      )}
      <ErrorText error={error} />
    </div>
  );
}
