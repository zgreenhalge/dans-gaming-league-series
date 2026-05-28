'use client';

import { useEffect, useState } from 'react';

type Pref = 'system' | 'light' | 'dark';
type Resolved = 'light' | 'dark';

const STORAGE_KEY = 'dgls-theme';

function readPref(): Pref {
  if (typeof window === 'undefined') return 'system';
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // localStorage unavailable
  }
  return 'system';
}

function resolve(pref: Pref): Resolved {
  if (pref === 'light' || pref === 'dark') return pref;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyResolved(pref: Pref) {
  document.documentElement.dataset.theme = resolve(pref);
}

export function ThemeToggle() {
  const [pref, setPref] = useState<Pref>('system');
  const [mounted, setMounted] = useState(false);

  // Pick up the stored pref on mount.
  useEffect(() => {
    setPref(readPref());
    setMounted(true);
  }, []);

  // While on "system", track OS pref changes live.
  useEffect(() => {
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyResolved('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [pref]);

  // Cross-tab sync.
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = readPref();
      setPref(next);
      applyResolved(next);
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  function choose(next: Pref) {
    setPref(next);
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
    applyResolved(next);
  }

  return (
    <select
      suppressHydrationWarning
      value={mounted ? pref : ''}
      onChange={(e) => choose(e.target.value as Pref)}
      aria-label="Theme"
      className="tracked text-[10px] font-semibold px-2 py-1 border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-primary)] transition-colors cursor-pointer focus:outline-none shrink-0"
    >
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  );
}
