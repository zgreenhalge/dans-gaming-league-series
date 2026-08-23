'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { useNav } from './NavContext';
import { usePersistedToggle } from './usePersistedToggle';
import { extractSeasonNumber } from '@/lib/util';
import { ScrimNavStatus } from './ScrimNavStatus';

interface NavSeason {
  id: number;
  name: string;
}

interface Props {
  seasons: NavSeason[];
}

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      aria-hidden
    >
      <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NavLink({
  href,
  prefetch,
  exact,
  children,
}: {
  href: string;
  prefetch?: boolean;
  /** Match only the exact path — for a link whose href is a prefix of a sibling link's href. */
  exact?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = exact
    ? pathname === href
    : pathname === href || (href !== '/' && pathname.startsWith(href));
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={[
        'block px-3 py-1.5 tracked text-[11px] font-semibold transition-colors',
        active
          ? 'text-[var(--color-text-primary)] bg-[var(--color-bg-secondary)]'
          : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)]',
      ].join(' ')}
    >
      {children}
    </Link>
  );
}

const DOCS_LINKS = [
  { href: '/docs', label: 'About' },
  { href: '/docs/faq', label: 'FAQ' },
  { href: '/docs/for-nerds', label: 'For Nerds' },
];

export function SideNav({ seasons }: Props) {
  const { desktopOpen, mobileOpen, setMobileOpen } = useNav();
  const [seasonsOpen, toggleSeasons] = usePersistedToggle('sidenav-seasons-open', true);
  const [docsOpen, toggleDocs] = usePersistedToggle('sidenav-docs-open', false);
  const pathname = usePathname();

  // Close mobile drawer on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

  const regularSeasons = seasons
    .filter((s) => !s.name.toLowerCase().includes('gauntlet'))
    .sort((a, b) => {
      const na = extractSeasonNumber(a.name) ?? 999;
      const nb = extractSeasonNumber(b.name) ?? 999;
      return na - nb;
    });

  const navContent = (
    <nav className="flex flex-col py-4 gap-0.5">
      <NavLink href="/">Home</NavLink>

      <div>
        <div className="flex items-center">
          <Link
            href="/seasons"
            className="flex-1 px-3 py-1.5 tracked text-[11px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
          >
            Seasons
          </Link>
          <button
            type="button"
            onClick={toggleSeasons}
            aria-expanded={seasonsOpen}
            aria-label="Toggle seasons"
            className="px-2 py-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <ChevronDown open={seasonsOpen} />
          </button>
        </div>
        {seasonsOpen && (
          <div className="ml-3 border-l border-[var(--color-border-tertiary)] pl-2 mt-0.5 mb-0.5 flex flex-col gap-0">
            {regularSeasons.map((s) => {
              const num = extractSeasonNumber(s.name);
              return (
                <NavLink key={s.id} href={`/seasons/${s.id}`}>
                  {num != null ? `Season ${num}` : s.name}
                </NavLink>
              );
            })}
          </div>
        )}
      </div>

      <NavLink href="/statistics">Statistics</NavLink>
      <NavLink href="/maps">Maps</NavLink>
      <NavLink href="/scrim" prefetch={false}>
        <span className="inline-flex items-center gap-1.5">
          Scrim
          <ScrimNavStatus />
        </span>
      </NavLink>

      <div>
        <div className="flex items-center">
          <Link
            href="/docs"
            className="flex-1 px-3 py-1.5 tracked text-[11px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
          >
            Docs
          </Link>
          <button
            type="button"
            onClick={toggleDocs}
            aria-expanded={docsOpen}
            aria-label="Toggle docs"
            className="px-2 py-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <ChevronDown open={docsOpen} />
          </button>
        </div>
        {docsOpen && (
          <div className="ml-3 border-l border-[var(--color-border-tertiary)] pl-2 mt-0.5 mb-0.5 flex flex-col gap-0">
            {DOCS_LINKS.map((l) => (
              <NavLink key={l.href} href={l.href} exact={l.href === '/docs'}>
                {l.label}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    </nav>
  );

  return (
    <>
      {/* Desktop rail — width driven by context state */}
      <aside
        className={`hidden md:flex flex-col shrink-0 border-r border-[var(--color-border-secondary)] sticky self-start overflow-y-auto bg-[var(--color-bg-primary)] transition-[width] duration-200 overflow-x-hidden ${
          desktopOpen ? 'w-[180px]' : 'w-0'
        }`}
        style={{ top: 'var(--content-top)', height: 'calc(100vh - var(--content-top))' }}
      >
        {desktopOpen && navContent}
      </aside>

      {/* Mobile overlay drawer — driven by context state */}
      {mobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <aside
            className="md:hidden fixed left-0 z-50 w-64 bg-[var(--color-bg-primary)] border-r border-[var(--color-border-primary)] overflow-y-auto"
            style={{ top: 'var(--content-top)', height: 'calc(100vh - var(--content-top))' }}
          >
            {navContent}
          </aside>
        </>
      )}
    </>
  );
}
