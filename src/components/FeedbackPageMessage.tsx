// Full-page shell for the player survey/superlatives pages' non-form states (signed out, didn't
// play, closed, nothing sent yet).

import Link from 'next/link';
import { TopbarShell } from './TopbarShell';

export function FeedbackPageShell({
  seasonId,
  seasonTitle,
  crumb,
  title,
  children,
}: {
  seasonId: number;
  seasonTitle: string;
  crumb: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <TopbarShell
        crumbs={[
          { label: 'DGLS', href: '/' },
          { label: seasonTitle, href: `/seasons/${seasonId}` },
          { label: crumb },
        ]}
      />
      <main className="max-w-[720px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-8 font-display text-[28px] font-semibold leading-tight">{title}</div>
        {children}
      </main>
    </div>
  );
}

export function FeedbackPageMessage({ seasonId, message }: { seasonId: number; message: string }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="font-mono text-[13px] text-[var(--color-text-secondary)]">{message}</div>
      <Link href={`/seasons/${seasonId}`} className="font-mono text-[12px] underline self-start">
        Back to the season
      </Link>
    </div>
  );
}
