'use client';

// Arm -> confirm button that sends one DELETE to reset a season's survey or superlatives vote, shared
// by both admin panels.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAsyncAction } from './useAsyncAction';
import { sendFeedbackRequest } from './feedbackRequest';
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
  const [armed, setArmed] = useState(false);
  const { busy, error, run } = useAsyncAction();

  return (
    <ArmedConfirmButton
      armed={armed}
      onArm={() => setArmed(true)}
      onCancel={() => setArmed(false)}
      onConfirm={() =>
        run(async () => {
          await sendFeedbackRequest('DELETE', url);
          setArmed(false);
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
