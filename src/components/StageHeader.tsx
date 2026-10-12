import Link from 'next/link';
import { StageStatusTag } from './StageStatusTag';
import type { StageStatus } from '@/lib/stage-views';

/** Title block shared by the week, round and group pages: status, title, a mono detail line and a
 *  link up to the season hub. */
export function StageHeader({
  title,
  status,
  details,
  upHref,
  upLabel,
}: {
  title: string;
  status: StageStatus;
  details: React.ReactNode;
  upHref: string;
  upLabel: string;
}) {
  return (
    <div className="mt-8 mb-6">
      <div className="flex items-center gap-3 flex-wrap">
        <StageStatusTag status={status} />
        <h1 className="font-display text-[32px] sm:text-[36px] font-semibold leading-tight">{title}</h1>
      </div>
      <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1.5 flex items-center gap-x-4 gap-y-1 flex-wrap">
        {details}
        <Link href={upHref} className="hover:text-[var(--color-text-primary)] transition-colors underline-offset-2 hover:underline">
          {upLabel} →
        </Link>
      </div>
    </div>
  );
}
