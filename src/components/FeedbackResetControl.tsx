'use client';

// Arm -> confirm button that sends one DELETE to reset a season's survey or superlatives vote, shared
// by both admin panels.

import { useRouter } from 'next/navigation';
import { useAsyncAction } from './useAsyncAction';
import { sendJsonRequest } from './sendJsonRequest';
import { ArmedConfirmButton } from './ArmedConfirmButton';

export function FeedbackResetControl({
  url,
  triggerLabel,
  confirmLabel,
}: {
  url: string;
  triggerLabel: string;
  confirmLabel: string;
}) {
  const router = useRouter();
  const { busy, error, run } = useAsyncAction();

  return (
    <ArmedConfirmButton
      onConfirm={() =>
        run(async () => {
          await sendJsonRequest('DELETE', url);
          router.refresh();
        })
      }
      busy={busy}
      error={error}
      triggerLabel={triggerLabel}
      confirmLabel={confirmLabel}
      busyLabel="Resetting…"
      variant="danger"
    />
  );
}
