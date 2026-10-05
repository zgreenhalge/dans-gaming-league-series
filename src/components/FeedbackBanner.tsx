// Season-page banner asking a signed-in player who played the season to take its open survey and/or
// cast their superlatives votes — each link opens the matching tab. Renders nothing when the viewer
// has nothing open to answer.

import Link from 'next/link';
import type { SeasonFeedbackView } from '@/lib/queries';

function Ask({ href, label, answered }: { href: string; label: string; answered: boolean }) {
  return (
    <Link href={href} className="lift-card flex items-center justify-between gap-4 px-4 py-3 border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <span className="font-display text-[15px] font-semibold">{label}</span>
      <span className={`tracked text-[10px] font-semibold ${answered ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-accent-green-fg)]'}`}>
        {answered ? 'Edit answers' : 'Take it now'}
      </span>
    </Link>
  );
}

export function FeedbackBanner({ seasonId, view }: { seasonId: number; view: SeasonFeedbackView }) {
  const ballot = view.superlatives?.mode === 'ballot' ? view.superlatives : null;
  if (!view.survey && !ballot) return null;
  return (
    <div className="mb-8 flex flex-col gap-2">
      {view.survey && <Ask href={`/seasons/${seasonId}?view=survey`} label="Post-season survey" answered={view.survey.responded} />}
      {ballot && (
        <Ask href={`/seasons/${seasonId}?view=superlatives`} label="Vote on the season's superlatives" answered={Object.keys(ballot.votes).length > 0} />
      )}
    </div>
  );
}
