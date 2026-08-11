import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import { CreateSeasonForm } from '@/components/CreateSeasonForm';
import { getSeasons, getMapLookup } from '@/lib/queries';
import { extractSeasonNumber } from '@/lib/util';

export const metadata = {
  title: 'Create Season',
  description: 'Create a new DGLS season.',
};

/**
 * Its own page rather than an inline panel in the admin console's Manage -> Season view (issue
 * #262) — season creation is a deliberate, occasional, multi-field flow (map pool + new-map entry),
 * not a quick action that belongs collapsed alongside a season list.
 */
export default async function NewSeasonPage() {
  // Admin gate lives in this route group's layout.tsx (#336).
  const session = await getSession();
  if (!session?.user?.playerId) redirect('/');

  const [seasons, mapLookup] = await Promise.all([getSeasons(), getMapLookup()]);

  let maxNum = 0;
  for (const s of seasons) {
    if (s.is_gauntlet) continue;
    const n = extractSeasonNumber(s.name);
    if (n !== null && n > maxNum) maxNum = n;
  }
  const nextName = `Season ${maxNum + 1} Regular Season`;

  const knownMaps = new Set<string>(Object.keys(mapLookup));
  for (const s of seasons) {
    for (const m of s.map_pool ?? []) {
      knownMaps.add(m.trim().toLowerCase());
    }
  }
  const sortedMaps = Array.from(knownMaps).sort();

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
            This will create <span className="text-[var(--color-text-primary)] font-semibold">{nextName}</span> with status UPCOMING.
          </div>
        </div>
        <CreateSeasonForm knownMaps={sortedMaps} />
      </main>
    </div>
  );
}
