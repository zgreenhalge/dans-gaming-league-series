// Season-page banner asking a signed-in player who played the season to take its open survey and/or
// cast their superlatives votes — each link opens the matching tab. The two asks are independent;
// each renders only when its own view says the viewer has something open to answer.

import Link from 'next/link';
import type { SurveyTabView, SuperlativesTabView } from '@/lib/queries';

function Ask({ href, label, cta, answered }: { href: string; label: string; cta: string; answered: boolean }) {
  return (
    <Link href={href} className="lift-card flex items-center justify-between gap-4 px-4 py-3 border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <span className="font-display text-[15px] font-semibold">{label}</span>
      <span className={`tracked text-[10px] font-semibold ${answered ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-accent-green-fg)]'}`}>
        {answered ? 'Edit answers' : cta}
      </span>
    </Link>
  );
}

export function FeedbackBanner({
  seasonId,
  survey,
  superlatives,
}: {
  seasonId: number;
  survey: SurveyTabView | null;
  superlatives: SuperlativesTabView | null;
}) {
  const ballot = superlatives?.mode === 'ballot' ? superlatives : null;
  if (!survey && !ballot) return null;
  return (
    <div className="mb-8 flex flex-col gap-2">
      {survey && <Ask href={`/seasons/${seasonId}?view=survey`} label="Post-season survey" cta="Take it now" answered={survey.responded} />}
      {ballot && (
        <Ask href={`/seasons/${seasonId}?view=superlatives`} label="Vote on the season's superlatives" cta="Vote now" answered={Object.keys(ballot.votes).length > 0} />
      )}
    </div>
  );
}
