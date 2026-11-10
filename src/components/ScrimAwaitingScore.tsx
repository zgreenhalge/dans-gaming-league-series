import Link from 'next/link';
import { scrimMatchHref } from '@/lib/crumbs';
import { ScrimDiscardButton } from './ScrimDiscardButton';
import SectionLabel from './SectionLabel';

/** For an admin: the night's matches that are over but have no score (the demo is parsing, or the
 *  server stopped early). Each links to its page to confirm the result, or is discarded here. */
export function ScrimAwaitingScore({ matches }: { matches: { id: number; match_number: number }[] }) {
  return (
    <div className="mb-4 border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <SectionLabel className="px-4 py-2 border-b border-[var(--color-border-tertiary)]">
        Awaiting score · {matches.length}
      </SectionLabel>
      {matches.map((m) => (
        <div key={m.id} className="px-4 py-2 border-b border-[var(--color-border-tertiary)] last:border-b-0 flex items-center justify-between gap-3 font-mono text-[12px]">
          <Link href={scrimMatchHref(m.id)} className="underline hover:text-[var(--color-text-primary)]">
            Match {m.match_number}
          </Link>
          <ScrimDiscardButton matchId={m.id} />
        </div>
      ))}
    </div>
  );
}
