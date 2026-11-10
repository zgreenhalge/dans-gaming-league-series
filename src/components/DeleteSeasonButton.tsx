'use client';

// Admin "delete an upcoming season" control. Arm/confirm like GauntletLifecycleList's reset, not a
// typed-name gate like its *force* reset — an UPCOMING season has no schedule or results yet
// (DELETE /api/seasons/[id] refuses anything else), so there's nothing irreplaceable to type-confirm.

import { useRouter } from 'next/navigation';
import { ArmedConfirmButton } from './ArmedConfirmButton';
import { useAsyncAction } from './useAsyncAction';

export default function DeleteSeasonButton({ seasonId }: { seasonId: number }) {
  const router = useRouter();
  const { busy, error, run } = useAsyncAction();

  async function del() {
    await run(async () => {
      const res = await fetch(`/api/seasons/${seasonId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to delete season.');
      }
      router.refresh();
    });
  }

  return (
    <ArmedConfirmButton
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
