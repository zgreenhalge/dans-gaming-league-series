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

  function cycle() {
    const next: Pref = pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system';
    setPref(next);
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
    applyResolved(next);
  }

  const label = 'Click to toggle';

  const glyph =
    pref === 'system' ? (
      <svg
        viewBox="0 0 16 16"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="1.5" y="2.5" width="13" height="9" rx="1" />
        <path d="M5.5 14.5h5M8 11.5v3" />
      </svg>
    ) : pref === 'light' ? (
      '☀'
    ) : (
      '☾'
    );

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={label}
      title={label}
      suppressHydrationWarning
      className="inline-flex items-center justify-center w-7 h-7 text-sm leading-none border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors shrink-0"
    >
      <span suppressHydrationWarning>{mounted ? glyph : ''}</span>
    </button>
  );
}
