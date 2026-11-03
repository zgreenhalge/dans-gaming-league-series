import Link from 'next/link';
import type { ReactNode } from 'react';

type StatusPillVariant = 'live' | 'neutral' | 'amber' | 'accent';

const BASE_CLS = 'inline-flex items-center gap-1.5 px-1.5 py-0.5 tracked text-[10px] font-semibold border shrink-0';

const VARIANT_CLS: Record<StatusPillVariant, string> = {
  live: 'text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] border-[var(--color-accent-green-border)]',
  neutral: 'text-[var(--color-text-secondary)] bg-[var(--color-bg-secondary)] border-[var(--color-border-primary)]',
  amber: 'text-[var(--color-accent-amber-fg)] bg-[var(--color-accent-amber-bg)] border-[var(--color-accent-amber-border)]',
  accent: 'text-[var(--color-site-accent)] bg-[color-mix(in_srgb,var(--color-site-accent)_12%,transparent)] border-[var(--color-site-accent)]',
};

/**
 * The small bordered status pill: green `live` (with a pulsing dot), grey `neutral` ("Final"),
 * `amber` ("Gauntlet live") or site-`accent` ("Sign up now"). `href` renders the pill as a link.
 */
export function StatusPill({
  variant,
  href,
  children,
}: {
  variant: StatusPillVariant;
  href?: string;
  children: ReactNode;
}) {
  const cls = `${BASE_CLS} ${VARIANT_CLS[variant]}`;
  const content = (
    <>
      {variant === 'live' && <span className="live-dot w-1.5 h-1.5 rounded-full bg-[var(--color-accent-green-fill)]" />}
      {children}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={cls}>
        {content}
      </Link>
    );
  }
  return <span className={cls}>{content}</span>;
}
