import Link from 'next/link';
import { StageStatusTag } from './StageStatusTag';
import type { StageStatus } from '@/lib/stage-views';
import type { StageHeading } from '@/lib/crumbs';

/** Title block shared by the week, round and group pages: the season's name (a link back to
 *  the season) over the stage's own name, and mono detail lines (one per fact, empty ones skipped),
 *  with the status tag at the top right. The heading comes from `stageHeading()` (crumbs.ts). */
export function StageHeader({
  heading,
  status,
  details,
}: {
  heading: StageHeading;
  status: StageStatus;
  details: React.ReactNode[];
}) {
  const link = 'block hover:text-[var(--color-site-accent)] transition-colors';
  return (
    <div className="mt-8 mb-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="font-display text-[32px] sm:text-[36px] font-semibold leading-tight">
          <Link href={heading.parent.href} className={link}>
            {heading.parent.label}
          </Link>
          {heading.title.map((level) =>
            level.href ? (
              <Link key={level.label} href={level.href} className={link}>
                {level.label}
              </Link>
            ) : (
              <span key={level.label} className="block">
                {level.label}
              </span>
            ),
          )}
        </h1>
        <div className="mt-2 shrink-0">
          <StageStatusTag status={status} />
        </div>
      </div>
      <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1.5 flex flex-col gap-1">
        {details.filter(Boolean).map((detail, i) => (
          <span key={i}>{detail}</span>
        ))}
      </div>
    </div>
  );
}
