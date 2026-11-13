'use client';

import { ADMIN_PRIMARY_BUTTON_CLS } from './adminButtonStyles';
import { sendJsonRequest } from './sendJsonRequest';
import { useAsyncAction } from './useAsyncAction';
import { MapPoolPicker, useMapPoolSelection } from './MapPoolPicker';
import ErrorText from '@/components/ErrorText';

interface Props {
  seasonId: number;
  mapPool: string[] | null;
  knownMaps: string[];
  /** Called after a save lands, and on Cancel. */
  onDone: (saved: boolean) => void;
}

/** An admin's editor for an UPCOMING season's map pool (a season can't go live without one), opened
 *  from `SeasonSetupDetails`' admin menu. */
export function SeasonMapPoolForm({ seasonId, mapPool, knownMaps, onDone }: Props) {
  const selection = useMapPoolSelection(mapPool ?? []);
  const { busy, error, run } = useAsyncAction();

  function save() {
    return run(async () => {
      await sendJsonRequest('PATCH', `/api/seasons/${seasonId}/map-pool`, {
        map_pool: selection.mapPool,
        new_maps: selection.newMaps,
      });
      onDone(true);
    });
  }

  return (
    <div className="flex flex-col gap-4 max-w-[640px]">
      <MapPoolPicker knownMaps={knownMaps} selection={selection} />
      <ErrorText error={error} size={12} />
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
          onClick={() => onDone(false)}
          className="tracked text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
