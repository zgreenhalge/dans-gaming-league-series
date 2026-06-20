import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import { getPlayer, getCareerLeaderboard, getH2HData, getPlayerEhogRating, getBatchMatchRatingDeltas, getAllSabremetrics } from '@/lib/queries';
import { isPlayedScore } from '@/lib/util';
import { maybeRefreshSteamProfile } from '@/lib/steam';
import PlayerView from '@/components/PlayerView';
import PlayerAvatar from '@/components/PlayerAvatar';
import EhogBadge from '@/components/EhogBadge';

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
  const [detail, careerLeaderboard, h2hData, ehog, leagueSabremetrics] = await Promise.all([
    getPlayer(playerId),
    getCareerLeaderboard(),
    getH2HData({ filter: 'career', includeRegular: true, includeGauntlet: true }),
    getPlayerEhogRating(playerId),
    // League-wide rows so the Advanced tab can compute Plus stats (player vs. league avg).
    getAllSabremetrics(),
  ]);
  if (!detail) notFound();

  const playedMatchIds = detail.history
    .filter((h) => isPlayedScore(h.final_score) && h.rounds_played > 0)
    .map((h) => h.match_id);
  const matchDeltasMap = await getBatchMatchRatingDeltas(playedMatchIds);
  const matchDeltas: Record<number, Record<number, number>> = {};
  for (const [matchId, playerMap] of matchDeltasMap) {
    matchDeltas[matchId] = Object.fromEntries(playerMap);
  }

  const freshSteam = await maybeRefreshSteamProfile(detail.player);
  if (freshSteam) {
    detail.player.steam_nickname = freshSteam.steam_nickname;
    detail.player.steam_avatar_url = freshSteam.steam_avatar_url;
  }

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
          <PlayerAvatar name={detail.player.name} imageUrl={detail.player.steam_avatar_url} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="font-display text-[42px] font-semibold leading-tight">
              {detail.player.name}
            </div>
            {detail.player.steam_id && detail.player.steam_nickname && (
              <Link
                href={`https://steamcommunity.com/profiles/${detail.player.steam_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                {detail.player.steam_nickname} ↗
              </Link>
            )}
          </div>
          {ehog.currentRating != null && (
            <EhogBadge rating={ehog.currentRating} />
          )}
        </div>
        <PlayerView
          playerId={detail.player.id}
          history={detail.history}
          trophies={detail.trophies}
          careerLeaderboard={careerLeaderboard}
          h2hData={h2hData}
          ehogHistory={ehog.history}
          matchDeltas={matchDeltas}
          sabremetrics={leagueSabremetrics}
        />
      </main>
    </div>
  );
}
