'use client';

// Admin "delete an upcoming season" control. Arm/confirm like GauntletLifecycleList's reset, not a
// typed-name gate like its *force* reset — an UPCOMING season has no schedule or results yet
// (DELETE /api/seasons/[id] refuses anything else), so there's nothing irreplaceable to type-confirm.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArmedConfirmButton } from './ArmedConfirmButton';

export default function DeleteSeasonButton({ seasonId }: { seasonId: number }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function del() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/seasons/${seasonId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Failed to delete season.');
        setArmed(false);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ArmedConfirmButton
      armed={armed}
      onArm={() => setArmed(true)}
      onCancel={() => setArmed(false)}
      onConfirm={del}
      busy={busy}
      error={error}
      triggerLabel="Delete"
      triggerStyle="link"
      confirmLabel="Confirm Delete"
      busyLabel="Deleting…"
      variant="danger"
    />
  );
}
