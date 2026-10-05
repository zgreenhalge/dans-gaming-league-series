'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toSentenceCase } from '@/lib/maps';
import { hasMapPool } from '@/lib/season-map-pool';
import { ADMIN_PRIMARY_BUTTON_CLS } from './ArmedConfirmButton';
import { useAsyncAction } from './useAsyncAction';
import { MapPoolPicker, useMapPoolSelection } from './MapPoolPicker';

interface Props {
  seasonId: number;
  mapPool: string[] | null;
  knownMaps: string[];
  canEdit: boolean;
}

/** An UPCOMING season's map pool. Shows "TBD" until it's set; admins can set or change it here
 * (a season can't go live without one). */
export function SeasonMapPoolPanel({ seasonId, mapPool, knownMaps, canEdit }: Props) {
  const router = useRouter();
  const selection = useMapPoolSelection(mapPool ?? []);
  const [editing, setEditing] = useState(false);
  const { busy: saving, error, run } = useAsyncAction();
  const [isPending, startTransition] = useTransition();

  async function save() {
    await run(async () => {
      const res = await fetch(`/api/seasons/${seasonId}/map-pool`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ map_pool: selection.mapPool, new_maps: selection.newMaps }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to save map pool.');
      }
      setEditing(false);
      startTransition(() => router.refresh());
    });
  }

  const busy = saving || isPending;
  const hasPool = hasMapPool(mapPool);

  if (!editing) {
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">
          Maps:{' '}
          {hasPool ? (
            mapPool!.map(toSentenceCase).join(', ')
          ) : (
            <span className="opacity-60">TBD</span>
          )}
        </span>
        {canEdit && (
          <button
            onClick={() => setEditing(true)}
            className="tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors"
          >
            {hasPool ? 'Edit' : 'Set map pool'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 max-w-[640px]">
      <MapPoolPicker knownMaps={knownMaps} selection={selection} />
      {error && <div className="text-[12px] text-[var(--color-accent-red-fg,#f87171)]">{error}</div>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy || !selection.isValid}
          className={`${ADMIN_PRIMARY_BUTTON_CLS} disabled:opacity-40`}
        >
          {busy ? 'Saving…' : 'Save map pool'}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="tracked text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
