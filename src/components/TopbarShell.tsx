'use client';

import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';
import { useSession, signIn, signOut } from 'next-auth/react';
import PlayerAvatar from './PlayerAvatar';

export interface Crumb {
  label: string;
  href?: string;
}

export function TopbarShell({
  crumbs,
  nav,
}: {
  crumbs: Crumb[];
  nav?: React.ReactNode;
}) {
  // Use the official NextAuth client session hook
  const { data: session, status } = useSession();
  const user = session?.user;

  return (
    <div className="sticky top-0 z-20 bg-[var(--color-bg-primary)] border-b-2 border-[var(--color-ct)]">
      <div className="max-w-[1080px] mx-auto px-6 py-3 flex items-center justify-between gap-6">

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

        <div className="flex items-center gap-4 shrink-0">
          {nav}
          {process.env.NODE_ENV === "development" && status !== "loading" && (
            <button
              onClick={() => user ? signOut() : signIn("dev-steam-mock", { steamId: "grachary" })}
              className="text-[11px] font-mono px-2 py-1 rounded border border-dashed border-yellow-500 text-yellow-500 hover:bg-yellow-500/10 transition-colors"
            >
              dev
            </button>
          )}
          <ThemeToggle />
          <div className="flex items-center">
            {status === "loading" ? (
              <div className="w-10 h-10 rounded-full bg-gray-700 animate-pulse" />
            ) : user ? (
              user.playerId != null ? (
                <Link href={`/players/${user.playerId}`}>
                  <PlayerAvatar name={user.name ?? "?"} imageUrl={user.image} size="md" />
                </Link>
              ) : (
                <PlayerAvatar name={user.name ?? "?"} imageUrl={user.image} size="md" />
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
