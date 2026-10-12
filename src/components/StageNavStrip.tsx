import Link from 'next/link';
import type { StageNav, StageNavItem } from '@/lib/stage-views';

const DOT: Record<StageNavItem['status'], string> = {
  complete: 'bg-[var(--color-text-secondary)]',
  'in-progress': 'bg-[var(--color-accent-green-fill)]',
  upcoming: 'border border-[var(--color-text-secondary)]',
};

function Chip({ item }: { item: StageNavItem }) {
  const base = 'inline-flex items-center gap-1.5 px-2 py-1 font-mono text-[11px] border transition-colors';
  const body = (
    <>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT[item.status]}`} aria-hidden />
      {item.chip}
    </>
  );
  const title = `${item.label} · ${item.status === 'in-progress' ? 'in progress' : item.status}`;
  if (item.current) {
    return (
      <span
        className={`${base} text-[var(--color-text-primary)] border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)] font-semibold`}
        aria-current="page"
        title={title}
      >
        {body}
      </span>
    );
  }
  if (!item.href) {
    return (
      <span className={`${base} text-[var(--color-text-secondary)] border-[var(--color-border-primary)] opacity-60`} title={`${item.label} · not scheduled yet`}>
        {body}
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      title={title}
      className={`${base} text-[var(--color-text-secondary)] border-[var(--color-border-primary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)]`}
    >
      {body}
    </Link>
  );
}

/** Previous / next links around a row of chips — one chip per sibling stage (week, round or group),
 *  dotted by status, the current one marked. Server-rendered; every link is a plain page. */
export function StageNavStrip({
  nav,
  prev = nav.prev,
  next = nav.next,
  noun,
}: {
  nav: StageNav;
  /** Override the neighbours (a group page steps across the whole bracket, not just its round). */
  prev?: StageNavItem | null;
  next?: StageNavItem | null;
  /** What the chips are, for the nav's accessible label ("Weeks", "Groups"). */
  noun: string;
}) {
  const arrowCls = 'tracked text-[10px] font-semibold px-2 py-1 border shrink-0 transition-colors';
  const live = 'text-[var(--color-text-secondary)] border-[var(--color-border-primary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)]';
  const dead = 'text-[var(--color-text-secondary)] border-[var(--color-border-primary)] opacity-40';
  return (
    <nav aria-label={noun} className="flex items-center gap-2 flex-wrap">
      {prev?.href ? (
        <Link href={prev.href} className={`${arrowCls} ${live}`} title={prev.label}>
          ← Prev
        </Link>
      ) : (
        <span className={`${arrowCls} ${dead}`}>← Prev</span>
      )}
      <div className="flex items-center gap-1 flex-wrap min-w-0">
        {nav.items.map((item) => (
          <Chip key={item.label} item={item} />
        ))}
      </div>
      {next?.href ? (
        <Link href={next.href} className={`${arrowCls} ${live}`} title={next.label}>
          Next →
        </Link>
      ) : (
        <span className={`${arrowCls} ${dead}`}>Next →</span>
      )}
    </nav>
  );
}
