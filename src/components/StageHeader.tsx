import Link from 'next/link';
import { StageStatusTag } from './StageStatusTag';
import type { StageStatus } from '@/lib/stage-views';

/** Title block shared by the week, round and group pages: the season's name (a link back to
 *  the season) over the stage's own name, and a mono detail line, with the status tag at the top right. */
export function StageHeader({
  season,
  title,
  status,
  details,
}: {
  season: { label: string; href: string };
  /** The stage's own name; a group page links its round part back to the round. */
  title: React.ReactNode;
  status: StageStatus;
  details: React.ReactNode;
}) {
  return (
    <div className="mt-8 mb-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="font-display text-[32px] sm:text-[36px] font-semibold leading-tight">
          <Link href={season.href} className="block hover:text-[var(--color-site-accent)] transition-colors">
            {season.label}
          </Link>
          <span className="block">{title}</span>
        </h1>
        <div className="mt-2 shrink-0">
          <StageStatusTag status={status} />
        </div>
      </div>
      <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1.5 flex items-center gap-x-4 gap-y-1 flex-wrap">
        {details}
      </div>
    </div>
  );
}
