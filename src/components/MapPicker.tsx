'use client';

// Map-select + custom-workshop-ID input — how `LaunchOptionsPicker` chooses a workshop map.

import { toSentenceCase } from '@/lib/maps';
import type { WorkshopMapOption } from '@/lib/queries';
import ErrorText from '@/components/ErrorText';

export const CUSTOM_MAP_CHOICE = '__custom__';

export function MapPicker({
  maps,
  value,
  onChange,
  customValue,
  onCustomChange,
  customInvalid,
  disabled,
}: {
  maps: WorkshopMapOption[];
  value: string;
  onChange: (value: string) => void;
  customValue: string;
  onCustomChange: (value: string) => void;
  customInvalid: boolean;
  disabled?: boolean;
}) {
  return (
    <>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="font-mono text-[12px] px-2 py-1.5 rounded border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] disabled:opacity-50"
      >
        <option value="">Select a map…</option>
        {maps.map((m) => (
          <option key={m.workshopId} value={m.workshopId}>
            {toSentenceCase(m.name)}
          </option>
        ))}
        <option value={CUSTOM_MAP_CHOICE}>Custom workshop ID…</option>
      </select>
      {value === CUSTOM_MAP_CHOICE && (
        <>
          <input
            value={customValue}
            onChange={(e) => onCustomChange(e.target.value)}
            placeholder="Steam workshop ID or URL"
            disabled={disabled}
            className="font-mono text-[12px] px-2 py-1.5 rounded border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] disabled:opacity-50"
          />
          <ErrorText error={customInvalid ? 'Enter a valid Steam workshop ID or URL.' : null} />
        </>
      )}
    </>
  );
}
