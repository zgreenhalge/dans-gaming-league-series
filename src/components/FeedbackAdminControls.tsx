'use client';

// The lifecycle controls at the top of a season's survey or superlatives admin panel: a status line
// with one open/close button (opening is the primary button, closing the small bordered one), and —
// once the form is locked, i.e. open or answered (`isFeedbackLocked()`) — a reset. A new lifecycle
// action is added here once for both panels.

import { useRouter } from 'next/navigation';
import { useAsyncAction } from './useAsyncAction';
import { sendFeedbackRequest } from './feedbackRequest';
import { ADMIN_PRIMARY_BUTTON_CLS, ADMIN_SMALL_BUTTON_CLS } from './adminButtonStyles';
import { FeedbackResetControl } from './FeedbackResetControl';

export function FeedbackAdminControls({
  openUrl,
  resetUrl,
  isOpen,
  isLocked,
  status,
  openLabel,
  closeLabel,
  resetLabel,
  resetConfirmLabel,
}: {
  /** Receives `PATCH { open }`. */
  openUrl: string;
  /** Receives `DELETE`. */
  resetUrl: string;
  isOpen: boolean;
  isLocked: boolean;
  /** What's been answered so far, e.g. "3 of 14 players responded". */
  status: string;
  openLabel: string;
  closeLabel: string;
  resetLabel: string;
  resetConfirmLabel: string;
}) {
  const router = useRouter();
  const { busy, error, run } = useAsyncAction();

  function toggleOpen() {
    return run(async () => {
      await sendFeedbackRequest('PATCH', openUrl, { open: !isOpen });
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[12px] text-[var(--color-text-secondary)]">
          {isOpen ? 'Open' : 'Closed'} · {status}
        </span>
        <button
          type="button"
          onClick={toggleOpen}
          disabled={busy}
          className={`${isOpen ? ADMIN_SMALL_BUTTON_CLS : ADMIN_PRIMARY_BUTTON_CLS} disabled:opacity-40`}
        >
          {isOpen ? closeLabel : openLabel}
        </button>
      </div>
      {isLocked && <FeedbackResetControl url={resetUrl} triggerLabel={resetLabel} confirmLabel={resetConfirmLabel} />}
      {error && <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)]">{error}</div>}
    </>
  );
}
