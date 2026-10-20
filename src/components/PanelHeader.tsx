import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The small `tracked` secondary link a panel carries on its right ("View all →", "All games →").
 * `hover` picks the hover color: the site accent (default) or primary text.
 */
export function PanelLink({
  href,
  hover = 'accent',
  children,
}: {
  href: string;
  hover?: 'accent' | 'primary';
  children: ReactNode;
}) {
  const hoverCls = hover === 'accent' ? 'hover:text-[var(--color-site-accent)]' : 'hover:text-[var(--color-text-primary)]';
  return (
    <Link
      href={href}
      className={`tracked text-[10px] text-[var(--color-text-secondary)] ${hoverCls} transition-colors shrink-0`}
    >
      {children}
    </Link>
  );
}

/**
 * A home panel's header strip: a linked display-font title on the left (`children` sit beside it,
 * e.g. status pills) and an optional `right` slot, usually a `PanelLink`. `align` is the cross-axis
 * alignment of the strip: `baseline` (default) lines the title up with the right link's text,
 * `center` suits a title row that carries pills.
 */
export function PanelHeader({
  title,
  titleHref,
  right,
  align = 'baseline',
  children,
}: {
  title: string;
  titleHref: string;
  right?: ReactNode;
  align?: 'baseline' | 'center';
  children?: ReactNode;
}) {
  return (
    <div
      className={`px-6 py-4 border-b border-[var(--color-border-tertiary)] flex ${align === 'center' ? 'items-center' : 'items-baseline'} justify-between gap-3`}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <Link
          href={titleHref}
          className="font-display text-[18px] font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-site-accent)] transition-colors"
        >
          {title}
        </Link>
        {children}
      </div>
      {right}
    </div>
  );
}
