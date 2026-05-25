'use client';

import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';

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
          <ThemeToggle />
        </div>

      </div>
    </div>
  );
}
