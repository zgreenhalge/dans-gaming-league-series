import { TopbarShell } from '@/components/TopbarShell';
import { CreateSeasonForm } from '@/components/CreateSeasonForm';
import { getSeasons, getKnownMapNames } from '@/lib/queries';
import { nextRegularSeasonName } from '@/lib/util';

export const metadata = {
  title: 'Create Season',
  description: 'Create a new DGLS season.',
};

/**
 * Its own page rather than an inline panel in the admin console's Manage -> Season view (issue
 * #262) — season creation is a deliberate, occasional, multi-field flow (optional map pool + new-map entry),
 * not a quick action that belongs collapsed alongside a season list.
 */
// Admin gate lives in this route group's layout.tsx (#336) — this page doesn't need the session
// itself.
export default async function NewSeasonPage() {
  const [seasons, knownMaps] = await Promise.all([getSeasons(), getKnownMapNames()]);

  const nextName = nextRegularSeasonName(seasons);

  return (
    <div className="min-h-screen">
      <TopbarShell
        crumbs={[
          { label: 'DGLS', href: '/' },
          { label: 'Admin', href: '/admin' },
          { label: 'Create Season' },
        ]}
      />
      <main className="max-w-[640px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-8">
          <div className="font-display text-[28px] font-semibold leading-tight">
            Create Season
          </div>
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-2">
            This will create <span className="text-[var(--color-text-primary)] font-semibold">{nextName}</span> with status UPCOMING. Signups can open without a map pool; set it later from the season page.
          </div>
        </div>
        <CreateSeasonForm knownMaps={knownMaps} />
      </main>
    </div>
  );
}
