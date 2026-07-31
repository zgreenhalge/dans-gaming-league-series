'use client';

// Admin "delete an upcoming season" control. Arm/confirm like GauntletLifecycleList's reset, not a
// typed-name gate like its *force* reset — an UPCOMING season has no schedule or results yet
// (DELETE /api/seasons/[id] refuses anything else), so there's nothing irreplaceable to type-confirm.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
    <div className="flex items-center gap-2">
      {armed ? (
        <>
          <button
            onClick={del}
            disabled={busy}
            className="tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-accent-red-border)] bg-[var(--color-accent-red-bg)] text-[var(--color-accent-red-fg)] hover:brightness-110 transition-all disabled:opacity-40"
          >
            {busy ? 'Deleting…' : 'Confirm Delete'}
          </button>
          <button
            onClick={() => setArmed(false)}
            disabled={busy}
            className="font-mono text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          onClick={() => setArmed(true)}
          className="font-mono text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-red-fg)] transition-colors underline decoration-dotted"
        >
          Delete
        </button>
      )}
      {error && <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)]">{error}</div>}
    </div>
  );
}
