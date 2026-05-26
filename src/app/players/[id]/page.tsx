import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import { getPlayer } from '@/lib/queries';
import PlayerView from '@/components/PlayerView';
import PlayerAvatar from '@/components/PlayerAvatar';

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getPlayer(Number(id));
  return { title: detail?.player.name ?? 'Player' };
}

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const playerId = Number(id);
  if (!Number.isFinite(playerId)) notFound();
  const detail = await getPlayer(playerId);
  if (!detail) notFound();

  return (
    <div className="min-h-screen">
      <TopbarShell
        crumbs={[
          { label: 'DGLS', href: '/' },
          { label: 'Statistics', href: '/statistics' },
          { label: detail.player.name },
        ]}
      />
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6 flex items-center gap-5">
          <PlayerAvatar name={detail.player.name} imageUrl={null} size="lg" />
          <div className="font-display text-[42px] font-semibold leading-tight">
            {detail.player.name}
          </div>
        </div>
        <PlayerView history={detail.history} />
      </main>
    </div>
  );
}
