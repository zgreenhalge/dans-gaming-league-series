import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { TopbarShell } from '@/components/TopbarShell';
import { getPlayer, getCareerLeaderboard, getPlayersById, getPlayerEhogRating, getBatchMatchRatingDeltas, getSabremetricSeasonTotals, getPlayerNameHistory, getAllMatchRounds, getAllMatchKills, getAllWeaponClassStats, getAllEconomyStats } from '@/lib/queries';
import { getPlayerMeta } from '@/lib/seo/og';
import { isPlayedScore } from '@/lib/util';
import { buildPlayerJsonLd } from '@/lib/seo/structured-data';
import { JsonLd } from '@/components/JsonLd';
import { maybeRefreshSteamProfile } from '@/lib/steam';
import PlayerView from '@/components/PlayerView';
import { UrlStateProvider } from '@/components/UrlStateProvider';
import PlayerAvatar from '@/components/PlayerAvatar';
import EhogBadge from '@/components/EhogBadge';
import PlayerNameEditor from '@/components/PlayerNameEditor';
import DiscordLinkButton from '@/components/DiscordLinkButton';

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const meta = await getPlayerMeta(Number(id));
  if (!meta) return { title: 'Player' };
  return {
    title: meta.name,
    description: meta.description,
    alternates: { canonical: `/players/${id}` },
    openGraph: {
      title: `DGLS · ${meta.name}`,
      description: meta.description,
    },
    twitter: {
      card: 'summary_large_image',
      title: `DGLS · ${meta.name}`,
      description: meta.description,
    },
  };
}

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ discord?: string }>;
}) {
  const { id } = await params;
  const { discord: discordFeedback } = await searchParams;
  const playerId = Number(id);
  if (!Number.isFinite(playerId)) notFound();
  // getPlayer()/getPlayersById()/getAllMatchKills()/getAllWeaponClassStats()/getAllEconomyStats()
  // (and, via resolveMatchSeasons(), getAllMatchRounds()/getSabremetricSeasonTotals()) all read
  // `players`/`player_match_stats`/`matches`/`weeks` independently, but are each wrapped in React's
  // `cache()` (#507), so calling them plainly here still collapses to one read per table across
  // this whole render pass rather than one per caller.
  const [session, detail, careerLeaderboard, playersById, ehog, leagueSabremetrics, nameHistory, playerMeta, matchRounds, matchKills, matchWeaponClassStats, economyStats] = await Promise.all([
    getServerSession(authOptions),
    getPlayer(playerId),
    getCareerLeaderboard(),
    getPlayersById(),
    getPlayerEhogRating(playerId),
    // League-wide, per-season totals so the Advanced tab can compute Plus stats (player vs.
    // league avg) without shipping every match row to the client.
    getSabremetricSeasonTotals(),
    getPlayerNameHistory(playerId),
    getPlayerMeta(playerId),
    getAllMatchRounds(),
    getAllMatchKills(),
    getAllWeaponClassStats(),
    getAllEconomyStats(),
  ]);
  const isSelf = session?.user?.playerId === playerId;
  if (!detail) notFound();

  // H2H is computed client-side (see PlayerView) so its Matchups tab honors the season filter —
  // only the id/name/avatar players need for it are passed down (same shape the Statistics page's
  // CareerStatsView already uses).
  const players = Array.from(playersById.values()).map((p) => ({
    id: p.id,
    name: p.name,
    steam_avatar_url: p.steam_avatar_url,
  }));

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

  const playerJsonLd = buildPlayerJsonLd({
    playerId: detail.player.id,
    name: detail.player.name,
    kd: playerMeta?.stats.kd ?? null,
    adr: playerMeta?.stats.adr ?? null,
    ehog: playerMeta?.stats.ehogRaw ?? null,
  });

  return (
    <div className="min-h-screen">
      <JsonLd data={playerJsonLd} />
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
            {isSelf ? (
              <PlayerNameEditor playerId={detail.player.id} name={detail.player.name} />
            ) : (
              <div className="font-display text-[42px] font-semibold leading-tight">
                {detail.player.name}
              </div>
            )}
            {nameHistory.length > 0 && (
              <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
                Formerly {[...nameHistory].reverse().map((h) => h.old_name).join(', ')}
              </div>
            )}
            {((detail.player.steam_id && detail.player.steam_nickname) || isSelf) && (
              <div className="mt-1 flex items-center gap-2 flex-wrap font-mono text-[12px]">
                <span className="tracked text-[10px] text-[var(--color-text-secondary)]">Connected:</span>
                {detail.player.steam_id && detail.player.steam_nickname && (
                  <Link
                    href={`https://steamcommunity.com/profiles/${detail.player.steam_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                  >
                    {detail.player.steam_nickname} ↗
                  </Link>
                )}
                {isSelf && (
                  <>
                    {detail.player.steam_id && detail.player.steam_nickname && (
                      <span className="text-[var(--color-border-primary)] select-none">·</span>
                    )}
                    <DiscordLinkButton linked={!!detail.player.discord_id} feedback={discordFeedback} />
                  </>
                )}
              </div>
            )}
          </div>
          {ehog.currentRating != null && (
            <EhogBadge rating={ehog.currentRating} />
          )}
        </div>
        <Suspense>
          <UrlStateProvider>
            <PlayerView
              playerId={detail.player.id}
              history={detail.history}
              trophies={detail.trophies}
              careerLeaderboard={careerLeaderboard}
              players={players}
              ehogHistory={ehog.history}
              matchDeltas={matchDeltas}
              sabremetrics={leagueSabremetrics}
              matchRounds={matchRounds}
              matchKills={matchKills}
              matchWeaponClassStats={matchWeaponClassStats}
              economyStats={economyStats}
            />
          </UrlStateProvider>
        </Suspense>
      </main>
    </div>
  );
}
