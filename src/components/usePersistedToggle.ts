import { useState } from 'react';
import { useHasMounted } from './useHasMounted';

function readStored(key: string, defaultValue: boolean): boolean {
  const stored = localStorage.getItem(key);
  return stored === null ? defaultValue : stored === 'true';
}

/**
 * Boolean UI toggle persisted to localStorage (e.g. sidebar collapse state). Server/first-paint
 * value is always `defaultValue` (matches useHasMounted's gating); the stored value takes over
 * once mounted, and toggling updates local state directly rather than re-reading localStorage —
 * this hook only has one reader per key today, so no cross-instance/cross-tab sync is needed.
 */
export function usePersistedToggle(key: string, defaultValue: boolean): [boolean, () => void] {
  const mounted = useHasMounted();
  const [override, setOverride] = useState<boolean | null>(null);

  const value = !mounted ? defaultValue : override ?? readStored(key, defaultValue);

  const toggle = () => {
    const next = !value;
    localStorage.setItem(key, String(next));
    setOverride(next);
  };

  return [value, toggle];
}
