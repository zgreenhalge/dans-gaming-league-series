import { useId } from 'react';
import SectionLabel from './SectionLabel';

/** A labelled −/+ number control clamped to `min`–`max`; the label names the group of its two buttons. */
export function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const labelId = useId();
  const btn = 'w-8 h-8 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-40';
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1.5">
      <SectionLabel as="span" id={labelId}>
        {label}
      </SectionLabel>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} className={btn} disabled={value <= min} onClick={() => onChange(value - 1)}>
          −
        </button>
        <span className="font-mono text-[14px] w-6 text-center">{value}</span>
        <button type="button" aria-label={`More ${label.toLowerCase()}`} className={btn} disabled={value >= max} onClick={() => onChange(value + 1)}>
          +
        </button>
      </div>
    </div>
  );
}
