'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ThemeToggle } from './ThemeToggle';
import { useSession, signIn, signOut } from 'next-auth/react';
import PlayerAvatar from './PlayerAvatar';
import { useNav } from './NavContext';

const DEV_USERS: { label: string; playerId: number | null; providerId: string | null }[] = [
  { label: 'Anonymous', playerId: null, providerId: null },
  { label: 'Zach',      playerId: 1,    providerId: 'dev-zach-mock' },
  { label: 'Dan',       playerId: 7,    providerId: 'dev-dan-mock' },
];

function DevToggle() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const currentPlayerId = session?.user?.playerId ?? null;

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  async function select(u: typeof DEV_USERS[number]) {
    setOpen(false);
    if (u.providerId === null) {
      await signOut({ redirect: false });
    } else {
      await signIn(u.providerId, { redirect: false });
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="text-[11px] font-mono px-2 py-1 rounded border border-dashed border-yellow-500 text-yellow-500 hover:bg-yellow-500/10 transition-colors"
      >
        dev
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[7rem] border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] shadow-lg">
          {DEV_USERS.map((u) => (
            <button
              key={u.label}
              type="button"
              onClick={() => select(u)}
              className={[
                'flex items-center w-full px-3 py-1.5 text-[13px] text-left',
                'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors',
                u.playerId === currentPlayerId ? 'font-semibold' : '',
              ].join(' ')}
            >
              {u.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface Crumb {
  label: string;
  href?: string;
}

function NavToggleButton() {
  const { toggleDesktop, mobileOpen, setMobileOpen } = useNav();
  return (
    <button
      type="button"
      onClick={() => { toggleDesktop(); setMobileOpen(!mobileOpen); }}
      aria-label="Toggle navigation"
      className="flex items-center justify-center w-8 h-8 shrink-0 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
    >
      <svg width="16" height="13" viewBox="0 0 16 13" fill="none" aria-hidden>
        <path d="M1 1h14M1 6.5h14M1 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

export function TopbarShell({
  crumbs,
  nav,
}: {
  crumbs: Crumb[];
  nav?: React.ReactNode;
}) {
  const { data: session, status } = useSession();
  const user = session?.user;

  return (
    <div className="fixed top-0 left-0 right-0 z-20 bg-[var(--color-bg-primary)]" style={{ height: 'var(--topbar-h)' }}>
      <div className="accent-stripe absolute bottom-0 left-0 right-0" />
      <div className="h-full px-3 flex items-center justify-between gap-3">

        <div className="flex items-center gap-1 min-w-0 overflow-hidden">
          <NavToggleButton />
        <nav className="flex items-center min-w-0 overflow-hidden" aria-label="Breadcrumb">
          {crumbs.map((crumb, i) => {
            const isFirst = i === 0;
            const isLast = i === crumbs.length - 1;
            return (
              <span key={i} className="flex items-center shrink-0">
                {i > 0 && (
                  <span className="mx-2 text-[var(--color-border-primary)] font-mono text-[12px] select-none">
                    /
                  </span>
                )}
                {crumb.href ? (
                  <Link
                    href={crumb.href}
                    className={
                      isFirst
                        ? 'font-display font-bold text-[20px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors leading-none'
                        : 'tracked text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors'
                    }
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span
                    className={
                      isFirst
                        ? 'font-display font-bold text-[20px] text-[var(--color-text-primary)] leading-none'
                        : isLast
                          ? 'tracked text-[11px] font-semibold text-[var(--color-text-primary)] truncate max-w-[200px]'
                          : 'tracked text-[11px] text-[var(--color-text-secondary)] truncate max-w-[160px]'
                    }
                    aria-current={isLast ? 'page' : undefined}
                  >
                    {crumb.label}
                  </span>
                )}
              </span>
            );
          })}
        </nav>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          {nav}
          {process.env.NODE_ENV === "development" && status !== "loading" && (
            <DevToggle />
          )}
          <ThemeToggle />
          <div className="flex items-center">
            {status === "loading" ? (
              <div className="w-10 h-10 rounded-full bg-gray-700 animate-pulse" />
            ) : user ? (
              user.playerId != null ? (
                <Link href={`/players/${user.playerId}`}>
                  <PlayerAvatar name={user.name ?? "?"} imageUrl={user.image} size="md" round />
                </Link>
              ) : (
                <PlayerAvatar name={user.name ?? "?"} imageUrl={user.image} size="md" round />
              )
            ) : (
              <a
                href="/api/auth/steam"
                className="text-[13px] font-medium tracking-wide text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                Login
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
