'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { DoubleheaderPolicy } from '@/lib/season-schedule';

interface Props {
  seasonId: number;
  hasSchedule: boolean;
}

const linkCls =
  'tracked text-[10px] font-semibold px-3 py-1.5 border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-secondary)] transition-colors self-start';

/** Season-page entry point into the schedule editor. Once a schedule (draft) exists, this is just
 * a link to the editor; before that, generation itself happens here — clicking Generate both
 * creates the schedule and takes the admin straight to the editor to review/hand-edit it, rather
 * than making them visit the editor first just to find the same Generate button there. */
export function SeasonScheduleEntryPoint({ seasonId, hasSchedule }: Props) {
  const router = useRouter();
  const [doubleheaderPolicy, setDoubleheaderPolicy] = useState<DoubleheaderPolicy>('auto');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (hasSchedule) {
    return (
      <Link href={`/admin/seasons/schedule/${seasonId}`} className={linkCls}>
        Edit Schedule →
      </Link>
    );
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/seasons/${seasonId}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doubleheaderPolicy }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Failed to generate the schedule.');
        return;
      }
      router.push(`/admin/seasons/schedule/${seasonId}`);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--color-text-secondary)]">
        <input
          type="checkbox"
          checked={doubleheaderPolicy === 'never'}
          onChange={(e) => setDoubleheaderPolicy(e.target.checked ? 'never' : 'auto')}
        />
        Never double-header (fails to generate if the roster size needs one)
      </label>
      {error && <div className="font-mono text-[11px] text-[var(--color-accent-red-fg)]">{error}</div>}
      <button type="button" onClick={generate} disabled={generating} className={`${linkCls} disabled:opacity-40`}>
        {generating ? 'Generating…' : 'Generate Schedule'}
      </button>
    </div>
  );
}
