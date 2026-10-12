import Link from 'next/link';
import type { StageNavItem } from '@/lib/stage-views';

function Chip({ item }: { item: StageNavItem }) {
  const base = 'inline-flex items-center px-2 py-1 font-mono text-[11px] border transition-colors';
  const body = item.chip;
  const title = item.label;
  // Played stages read bright, stages with nothing played yet read dim.
  const tone = item.played ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]';
  if (item.current) {
    return (
      <span
        className={`${base} font-bold text-[var(--color-bg-primary)] bg-[var(--color-site-accent)] border-[var(--color-site-accent)]`}
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
      className={`${base} ${tone} border-[var(--color-border-primary)] hover:border-[var(--color-border-secondary)]`}
    >
      {body}
    </Link>
  );
}

/** A chip leading out of the strip's own set of stages — a week page's way into the gauntlet, a
 *  gauntlet page's way back to the regular season. Drawn in the site accent, apart from the chips. */
function MetaChip({ meta }: { meta: StageNavMeta }) {
  return (
    <Link
      href={meta.href}
      className="self-start inline-flex items-center px-2 py-1 tracked text-[10px] font-semibold border shrink-0 transition-opacity hover:opacity-80"
      style={{
        color: 'var(--color-site-accent)',
        background: 'color-mix(in srgb, var(--color-site-accent) 12%, transparent)',
        borderColor: 'var(--color-site-accent)',
      }}
    >
      {meta.label}
    </Link>
  );
}

export interface StageNavMeta {
  label: string;
  href: string;
}

/** A row of chips under its label — one per sibling stage (week, round or group), the current one marked —
 *  plus an optional meta chip on its own line, above or below the chips. Server-rendered; every link is a plain page. A lone
 *  stage chip would only repeat the page's own title, so the row needs two or more to show; with
 *  neither chips nor a meta chip, nothing renders. */
export function StageNavStrip({
  items,
  label,
  meta,
  metaPosition = 'below',
}: {
  items: StageNavItem[];
  /** What the chips are ("Weeks", "Rounds", "Groups") — shown above them and as the nav's label. */
  label: string;
  meta?: StageNavMeta;
  /** Whether the meta chip sits on its own line above the stage chips or below them. */
  metaPosition?: 'above' | 'below';
}) {
  const showItems = items.length > 1;
  if (!showItems && !meta) return null;
  return (
    <nav aria-label={label} className="flex flex-col items-start gap-3">
      {metaPosition === 'above' && meta && <MetaChip meta={meta} />}
      {showItems && (
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="tracked text-[9px] font-semibold text-[var(--color-text-secondary)]">{label}</span>
          <div className="flex items-center gap-1 flex-wrap">
            {items.map((item) => (
              <Chip key={item.label} item={item} />
            ))}
          </div>
        </div>
      )}
      {metaPosition === 'below' && meta && <MetaChip meta={meta} />}
    </nav>
  );
}
