'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useHasMounted } from './useHasMounted';

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

function MonitorIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="9" rx="1" />
      <path d="M5.5 14.5h5M8 11.5v3" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.22 3.22l1.42 1.42M11.36 11.36l1.42 1.42M11.36 4.64l-1.42 1.42M4.64 11.36l-1.42 1.42" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13.5 10.5A6 6 0 0 1 5.5 2.5a6 6 0 1 0 8 8z" />
    </svg>
  );
}

const OPTIONS: { value: Pref; label: string; Icon: () => ReactElement }[] = [
  { value: 'system', label: 'System', Icon: MonitorIcon },
  { value: 'light',  label: 'Light',  Icon: SunIcon },
  { value: 'dark',   label: 'Dark',   Icon: MoonIcon },
];

export function ThemeToggle() {
  // Lazy-initialized on the client only; rendering is gated on `mounted` below so
  // this never causes a hydration mismatch even though it reads localStorage.
  const [pref, setPref] = useState<Pref>(() => readPref());
  const mounted = useHasMounted();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyResolved('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [pref]);

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

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function select(next: Pref) {
    setPref(next);
    setOpen(false);
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
    applyResolved(next);
  }

  const current = OPTIONS.find(o => o.value === pref) ?? OPTIONS[0];
  const CurrentIcon = current.Icon;
  // Server always renders as 'system' (readPref() sees no window); keep the label/aria-label
  // matching that until mounted, even though `pref` itself is read eagerly — otherwise these
  // attributes (which suppressHydrationWarning does NOT cover, only text content) can mismatch.
  const displayLabel = mounted ? current.label : OPTIONS[0].label;

  return (
    <div ref={ref} className="relative" suppressHydrationWarning>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label={`Theme: ${displayLabel}`}
        title={`Theme: ${displayLabel}`}
        suppressHydrationWarning
        className="inline-flex items-center justify-center w-7 h-7 border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors shrink-0"
      >
        <span suppressHydrationWarning>{mounted ? <CurrentIcon /> : ''}</span>
      </button>

      {open && mounted && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[7rem] border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] shadow-lg">
          {OPTIONS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => select(value)}
              className={[
                'flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left',
                'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors',
                pref === value ? 'font-semibold' : '',
              ].join(' ')}
            >
              <Icon />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
