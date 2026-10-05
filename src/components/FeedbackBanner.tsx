// Season-page banner asking a signed-in player who played the season to take its open survey and/or
// cast their superlatives votes. Renders nothing when neither is open (the caller passes null).

import Link from 'next/link';
import type { PlayerFeedbackStatus } from '@/lib/queries';

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

export function FeedbackBanner({ seasonId, status }: { seasonId: number; status: PlayerFeedbackStatus | null }) {
  if (!status) return null;
  return (
    <div className="mb-8 flex flex-col gap-2">
      {status.survey && <Ask href={`/seasons/${seasonId}/survey`} label="Post-season survey" answered={status.survey.answered} />}
      {status.superlatives && (
        <Ask href={`/seasons/${seasonId}/superlatives`} label="Vote on the season's superlatives" answered={status.superlatives.answered} />
      )}
    </div>
  );
}
