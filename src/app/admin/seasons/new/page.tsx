import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { redirect } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import { CreateSeasonForm } from '@/components/CreateSeasonForm';
import { getSeasons, getMapLookup } from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import { extractSeasonNumber } from '@/lib/util';

export const metadata = {
  title: 'Create Season',
  description: 'Create a new DGLS season.',
};

export default async function NewSeasonPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.playerId) redirect('/');

  const { data: playerRow } = await supabase
    .from('players')
    .select('is_admin')
    .eq('id', session.user.playerId)
    .maybeSingle();

  if (!(playerRow as { is_admin?: boolean } | null)?.is_admin) redirect('/');

  const [seasons, mapLookup] = await Promise.all([getSeasons(), getMapLookup()]);

  let maxNum = 0;
  for (const s of seasons) {
    if (s.is_gauntlet) continue;
    const n = extractSeasonNumber(s.name);
    if (n !== null && n > maxNum) maxNum = n;
  }
  const nextName = `Season ${maxNum + 1}`;

  // Collect all known map names: maps table + prior season map pools
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
          { label: 'Seasons', href: '/seasons' },
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
