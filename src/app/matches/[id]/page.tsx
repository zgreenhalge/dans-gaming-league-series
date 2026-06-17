import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { getMatch, getMatchScoutingData, getH2HData, getMatchRatingDeltas, getPlayerRatings } from '@/lib/queries';
import { projectRatingDeltas, type RatingProjection } from '@/lib/ehog';
import type { Match } from '@/lib/types';
import { isPlayedScore, parseScore } from '@/lib/util';
import { mapImageFor } from '@/lib/maps';
import { TopbarShell } from '@/components/TopbarShell';
import MatchHeaderSection from '@/components/MatchHeaderSection';
import VetoSequence from '@/components/VetoSequence';
import MatchTabView from '@/components/MatchTabView';
import { authOptions } from '@/lib/authOptions';
import { supabase } from '@/lib/supabase';
import { FeatureMatchBanner } from '@/components/FeatureMatch';
import { HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { r2, R2_BUCKET, demoKey as makeDemoKey } from '@/lib/r2';

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getMatch(Number(id));
  if (!detail) return { title: 'Match' };
  const { match, week, season } = detail;
  const weekLabel = season.is_gauntlet ? `Round ${week.week_number}` : `Week ${week.week_number}`;
  return {
    title: `${season.name} · ${weekLabel} · Match ${match.match_number}`,
  };
}

type Faction = 'CT' | 'T' | null;

function shirtsFaction(skinsSide: 'CT' | 'T' | null): Faction {
  if (skinsSide === 'CT') return 'T';
  if (skinsSide === 'T') return 'CT';
  return null;
}

function factionClass(f: Faction): string {
  if (f === 'CT') return 'faction-ct';
  if (f === 'T') return 'faction-t';
  return '';
}


function Topbar({
  seasonId,
  seasonName,
  weekNumber,
  matchNumber,
  isGauntlet,
}: {
  seasonId: number;
  seasonName: string;
  weekNumber: number;
  matchNumber: number;
  isGauntlet: boolean;
}) {
  return (
    <TopbarShell
      crumbs={[
        { label: 'DGLS', href: '/' },
        { label: seasonName, href: `/seasons/${seasonId}` },
        { label: `${isGauntlet ? 'Round' : 'Week'} ${weekNumber} · Match ${matchNumber}` },
      ]}
    />
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="tracked text-[10px] text-[var(--color-text-secondary)] mt-10 mb-3">
      {children}
    </div>
  );
}



function matchWeekWindow(
  startDate: string | null,
  weekNumber: number,
): { weekStart: string; weekEnd: string } | null {
  if (!startDate) return null;
  const [y, m, d] = startDate.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  const startMs = base + (weekNumber - 1) * 7 * 86_400_000;
  const endMs = base + ((weekNumber - 1) * 7 + 6) * 86_400_000;
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { weekStart: fmt(startMs), weekEnd: fmt(endMs) };
}

export default async function MatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const matchId = Number(id);
  if (!Number.isFinite(matchId)) notFound();
  const detail = await getMatch(matchId);
  if (!detail) notFound();

  const { match, week, season, stats } = detail;
  const played = isPlayedScore(match.final_score);
  const score = played ? parseScore(match.final_score) : null;
  const map = match.shirts_pick ?? match.picked_map;
  const mapImg = mapImageFor(map);

  const shirts = stats.filter((s) => s.faction === 'SHIRTS');
  const skins = stats.filter((s) => s.faction === 'SKINS');

  const showScouting = shirts.length === 2 && skins.length === 2;
  const key = makeDemoKey(matchId);
  const [scoutingData, scoutingH2H, demoDownloadUrl, ratingDeltaMap] = await Promise.all([
    showScouting ? getMatchScoutingData(matchId) : Promise.resolve(null),
    showScouting
      ? getH2HData({ filter: 'career', includeRegular: true, includeGauntlet: true })
      : Promise.resolve(null),
    r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }))
      .then(() =>
        getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), {
          expiresIn: 3600,
        }),
      )
      .catch(() => null),
    played ? getMatchRatingDeltas(matchId) : Promise.resolve(new Map<number, number>()),
  ]);
  const ratingDeltas: Record<number, number> = Object.fromEntries(ratingDeltaMap);

  // Compute rating projections for unplayed matches with full rosters
  let ratingProjections: RatingProjection[] = [];
  if (!played && shirts.length === 2 && skins.length === 2) {
    const allPlayerIds = [...shirts, ...skins].map((s) => s.player_id);
    const playerRatings = await getPlayerRatings(allPlayerIds);
    const byId = new Map(playerRatings.map((r) => [r.playerId, r]));
    const shirtRatings = shirts.map((s) => byId.get(s.player_id)!);
    const skinRatings = skins.map((s) => byId.get(s.player_id)!);
    ratingProjections = projectRatingDeltas(shirtRatings, skinRatings, season.target_win_rounds);
  }

  const allByAdr = [...stats]
    .filter((s) => s.rounds_played > 0)
    .sort((a, b) => b.adr - a.adr);
  const mvpPlayerId =
    played && allByAdr.length > 0 ? allByAdr[0].player_id : null;

  const shirtsWon = score ? score.shirts > score.skins : false;
  const shirtsF = shirtsFaction(match.skins_starting_side);
  const skinsF: Faction = match.skins_starting_side;

  const session = await getServerSession(authOptions);
  const currentPlayerId = session?.user?.playerId ?? null;

  // Veto window: open only when a scheduled time exists and we're within 10 minutes of it
  const vetoWindowOpen =
    !!match.scheduled_at &&
    Date.now() >= new Date(match.scheduled_at).getTime() - 10 * 60 * 1000;

  // Veto complete: all required pick/ban fields are filled
  const isGauntletOrPlayoff = season.is_gauntlet || match.is_playoff_game;
  const vetoComplete = isGauntletOrPlayoff
    ? !!(match.shirts_ban && match.shirts_ban2 && match.skins_ban1 && match.skins_ban2)
    : !!(match.shirts_ban && match.skins_ban1 && match.skins_ban2 && match.shirts_pick && match.skins_starting_side);

  // Determine edit/veto permissions: admins or players in the match
  let canEdit = false;
  let canVeto = false;
  let canEnterResults = false;
  let playerFaction: 'SHIRTS' | 'SKINS' | null = null;
  let gauntletPlayerIndex: 0 | 1 | null = null;
  let vetoIsAdmin = false;
  let isCurrentUserAdmin = false;
  if (currentPlayerId !== null) {
    const myStatRow = stats.find((s) => s.player_id === currentPlayerId);
    const isInMatch = !!myStatRow;
    const { data: playerRow } = await supabase
      .from('players')
      .select('is_admin')
      .eq('id', currentPlayerId)
      .maybeSingle();
    const isAdmin = !!(playerRow as { is_admin?: boolean } | null)?.is_admin;
    isCurrentUserAdmin = isAdmin;
    const authorized = isInMatch || isAdmin;
    if (authorized && !played) {
      // Non-admins are blocked from veto until the window opens
      canVeto = isAdmin || vetoWindowOpen;
      vetoIsAdmin = isAdmin;
      if (!season.is_gauntlet) canEdit = true;
      if (myStatRow) {
        playerFaction = myStatRow.faction as 'SHIRTS' | 'SKINS';
        if (season.is_gauntlet) {
          const factionPlayerIds = stats
            .filter((s) => s.faction === myStatRow.faction)
            .map((s) => s.player_id)
            .sort((a, b) => a - b);
          const idx = factionPlayerIds.indexOf(currentPlayerId);
          gauntletPlayerIndex = idx === 0 ? 0 : idx === 1 ? 1 : null;
        }
      }
    }
    // Can enter results: veto complete + (in match or admin). Admins can also edit after played.
    if (authorized && vetoComplete && (!played || isAdmin)) {
      canEnterResults = true;
    }
  }

  const window = matchWeekWindow(season.start_date, week.week_number);

  return (
    <div className="min-h-screen">
      <div className="centering">{match.is_feature_match && <FeatureMatchBanner />}</div>
      <Topbar seasonId={season.id} seasonName={season.name} weekNumber={week.week_number} matchNumber={match.match_number} isGauntlet={season.is_gauntlet} />
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        {/* Header + veto wrapped in map backdrop — gradient shows regardless of image */}
        <div
          className={`-mx-6 px-6 ${map ? 'map-card-bg light-boost' : 'map-no-img'}`}
          style={
            map
              ? ({
                  ['--map-img' as string]: mapImg ? `url("${mapImg}")` : 'none',
                } as React.CSSProperties)
              : undefined
          }
        >
          <div className="pt-8 pb-6">
            <MatchHeaderSection
              map={map}
              matchId={match.id}
              scheduledAt={match.scheduled_at}
              weekStart={window?.weekStart ?? null}
              weekEnd={window?.weekEnd ?? null}
              canEdit={canEdit}
              played={played}
              isGauntlet={season.is_gauntlet}
            />

            {score && (
              <div className="mt-5 flex items-baseline justify-center gap-5 flex-wrap">
                <div className={`${factionClass(shirtsF)} flex items-baseline gap-3`}>
                  <span className="font-display text-[24px] font-bold faction-fg">
                    Shirts
                  </span>
                  <span className="display-numeral text-[64px] text-[var(--color-text-primary)] tnum [text-shadow:-1px_-1px_0_black,1px_-1px_0_black,-1px_1px_0_black,1px_1px_0_black]">
                    {score.shirts}
                  </span>
                </div>
                <span className="font-mono text-[24px] text-[var(--color-text-secondary)]">
                  —
                </span>
                <div className={`${factionClass(skinsF)} flex items-baseline gap-3`}>
                  <span className="display-numeral text-[64px] text-[var(--color-text-primary)] tnum [text-shadow:-1px_-1px_0_black,1px_-1px_0_black,-1px_1px_0_black,1px_1px_0_black]">
                    {score.skins}
                  </span>
                  <span className="font-display text-[24px] font-bold faction-fg">
                    Skins
                  </span>
                </div>
              </div>
            )}
          </div>

          {(played || vetoIsAdmin || vetoWindowOpen) && (
            <>
              <div className="mb-3">
                <span className="map-text-scrim tracked text-[10px] text-[var(--color-text-secondary)]">Map pick/ban</span>
              </div>
              <div className="pb-6">
                <VetoSequence
                  match={match}
                  mapPool={season.map_pool}
                  canVeto={canVeto}
                  isGauntlet={season.is_gauntlet}
                  playerFaction={playerFaction}
                  gauntletPlayerIndex={gauntletPlayerIndex}
                  isAdmin={vetoIsAdmin}
                />
              </div>
            </>
          )}

        </div>

        <MatchTabView
          shirts={shirts}
          skins={skins}
          score={score}
          shirtsWon={shirtsWon}
          shirtsF={shirtsF}
          skinsF={skinsF}
          mvpPlayerId={mvpPlayerId}
          currentPlayerId={currentPlayerId}
          played={played}
          canEnterResults={canEnterResults}
          isCurrentUserAdmin={isCurrentUserAdmin}
          matchId={match.id}
          matchPlayers={stats.map((s) => ({
            player_id: s.player_id,
            player_name: s.player_name,
            faction: s.faction as 'SHIRTS' | 'SKINS',
          }))}
          targetWinRounds={season.target_win_rounds}
          skinsSide={match.skins_starting_side}
          scoutingData={scoutingData}
          scoutingH2H={scoutingH2H}
          matchMap={map}
          mapPool={season.map_pool}
          demoDownloadUrl={demoDownloadUrl}
          ratingDeltas={ratingDeltas}
          ratingProjections={ratingProjections}
        />
      </main>
    </div>
  );
}
