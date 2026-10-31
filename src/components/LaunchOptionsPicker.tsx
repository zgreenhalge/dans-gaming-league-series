'use client';

// Config-set + map + launch-time-toggle controls — what `ServerConsolePanel`'s Start/Apply config set
// actions launch with.

import { MapPicker } from '@/components/MapPicker';
import type { ConfigSetOption } from '@/lib/dathost-config';
import type { WorkshopMapOption } from '@/lib/queries';

export function LaunchOptionsPicker({
  configSets,
  configSet,
  onConfigSetChange,
  maps,
  mapChoice,
  onMapChoiceChange,
  customMapId,
  onCustomMapIdChange,
  customMapInvalid,
  playout,
  onPlayoutChange,
  friendly,
  onFriendlyChange,
  disabled,
}: {
  configSets: ConfigSetOption[];
  configSet: string;
  onConfigSetChange: (key: string) => void;
  maps: WorkshopMapOption[];
  mapChoice: string;
  onMapChoiceChange: (value: string) => void;
  customMapId: string;
  onCustomMapIdChange: (value: string) => void;
  customMapInvalid: boolean;
  playout: boolean;
  onPlayoutChange: (value: boolean) => void;
  friendly: boolean;
  onFriendlyChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <select
        value={configSet}
        onChange={(e) => onConfigSetChange(e.target.value)}
        disabled={disabled}
        className="font-mono text-[12px] px-2 py-1.5 rounded border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] disabled:opacity-50"
      >
        {configSets.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </select>
      <MapPicker
        maps={maps}
        value={mapChoice}
        onChange={onMapChoiceChange}
        customValue={customMapId}
        onCustomChange={onCustomMapIdChange}
        customInvalid={customMapInvalid}
        disabled={disabled}
      />
      <label className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[var(--color-text-secondary)]">
        <input type="checkbox" checked={playout} onChange={(e) => onPlayoutChange(e.target.checked)} disabled={disabled} />
        Play out all rounds
      </label>
      <label className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[var(--color-text-secondary)]">
        <input type="checkbox" checked={friendly} onChange={(e) => onFriendlyChange(e.target.checked)} disabled={disabled} />
        Friendly
      </label>
    </>
  );
}
