import { TopbarShell } from '@/components/TopbarShell';
import { getMapIndex } from '@/lib/queries';
import MapIndexView from '@/components/MapIndexView';

export const revalidate = 60;
export const metadata = {
  title: 'Maps',
  description: 'Map stats, pick/ban rates, and player performance across all DGLS maps.',
};

export default async function MapsPage() {
  const maps = await getMapIndex();

  return (
    <div className="min-h-screen">
      <TopbarShell
        crumbs={[
          { label: 'DGLS', href: '/' },
          { label: 'Maps' },
        ]}
      />
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <div className="font-display text-[36px] font-semibold leading-tight">Maps</div>
        </div>

        {maps.length === 0 ? (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">No maps found.</div>
        ) : (
          <MapIndexView maps={maps} />
        )}
      </main>
    </div>
  );
}
