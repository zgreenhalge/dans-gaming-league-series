import { useCallback, useSyncExternalStore } from 'react';

const listeners = new Map<string, Set<() => void>>();

function emit(key: string) {
  listeners.get(key)?.forEach((onChange) => onChange());
}

function subscribe(key: string) {
  return (onChange: () => void) => {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(onChange);
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) onChange();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.get(key)!.delete(onChange);
      window.removeEventListener('storage', onStorage);
    };
  };
}

function readStored(key: string, defaultValue: boolean): boolean {
  const stored = localStorage.getItem(key);
  return stored === null ? defaultValue : stored === 'true';
}

/**
 * Boolean UI toggle persisted to localStorage (e.g. sidebar collapse state).
 * Reads via useSyncExternalStore so the server/first-paint value is always
 * `defaultValue` and the stored value takes over post-hydration, without a
 * setState-in-effect flash.
 */
export function usePersistedToggle(key: string, defaultValue: boolean): [boolean, () => void] {
  const value = useSyncExternalStore(
    subscribe(key),
    () => readStored(key, defaultValue),
    () => defaultValue,
  );

  const toggle = useCallback(() => {
    localStorage.setItem(key, String(!readStored(key, defaultValue)));
    emit(key);
  }, [key, defaultValue]);

  return [value, toggle];
}
