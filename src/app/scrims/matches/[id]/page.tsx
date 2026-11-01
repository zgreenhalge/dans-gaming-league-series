import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import MatchScoreHero from '@/components/MatchScoreHero';
import MatchServerPanel from '@/components/MatchServerPanel';
import MatchDemoReviewBlock from '@/components/MatchDemoReviewBlock';
import MatchTabView from '@/components/MatchTabView';
import RoundHistoryStrip from '@/components/RoundHistoryStrip';
import { UrlStateProvider } from '@/components/UrlStateProvider';
import { getSession } from '@/lib/session';
import { getMapLookup, getMatchServerState, getPlayersById, getScrimMatchDetail } from '@/lib/queries';
import { loadMatchPageFacts, matchMvpPlayerId, shirtsFaction } from '@/lib/match-page-data';
import { scrimNightHref } from '@/lib/crumbs';
import { formatNightDate } from '@/lib/scrim-schedule';
import { effectivePickedMap, effectiveSkinsStartingSide } from '@/lib/veto';
import { mapImageFor, mapSidesHref } from '@/lib/maps';
import { isPlayedScore, parseRouteId, parseScore } from '@/lib/util';

// The server panel's state and the lobby's lock change live; don't cache.
export const dynamic = 'force-dynamic';

/** A scrim match plays to the default 13 — it has no season to set `target_win_rounds`. */
const SCRIM_TARGET_WIN_ROUNDS = 13;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const matchId = parseRouteId((await params).id);
  const match = matchId === null ? null : await getScrimMatchDetail(matchId);
  return { title: match ? `Scrim · ${formatNightDate(match.night_date)} · Match ${match.match_number}` : 'Scrim match' };
}

/** A scrim match's page: the same score header, server panel, demo review and stat tabs as a league
 *  match (`loadMatchPageFacts()`), without anything a season brings — pick/ban, EHOG, scouting. */
export default async function ScrimMatchPage({ params }: { params: Promise<{ id: string }> }) {
  const matchId = parseRouteId((await params).id);
  if (matchId === null) notFound();
  const [match, session, mapLookup, playersById] = await Promise.all([
    getScrimMatchDetail(matchId),
    getSession(),
    getMapLookup(),
    getPlayersById(),
  ]);
  if (!match) notFound();

  const played = isPlayedScore(match.final_score);
  const [facts, serverState] = await Promise.all([
    loadMatchPageFacts(matchId, played),
    played ? Promise.resolve('idle' as const) : getMatchServerState(matchId),
  ]);

  const { stats } = match;
  const shirts = stats.filter((s) => s.faction === 'SHIRTS');
  const skins = stats.filter((s) => s.faction === 'SKINS');
  const score = played ? parseScore(match.final_score) : null;
  const shirtsWon = score ? score.shirts > score.skins : false;
  const map = effectivePickedMap(match);
  const mapImg = mapImageFor(map, mapLookup);
  // A scrim match is ready to play once its lobby has set the map (`isReadyToPlay()`).
  const ready = map != null;
  const skinsStartingSide = effectiveSkinsStartingSide(match);
  const shirtsF = shirtsFaction(skinsStartingSide);

  const currentPlayerId = session?.user?.playerId ?? null;
  const isAdmin = currentPlayerId != null && !!playersById.get(currentPlayerId)?.is_admin;
  const canManage = currentPlayerId != null && (isAdmin || stats.some((s) => s.player_id === currentPlayerId));

  return (
    <div className="min-h-screen">
      <TopbarShell
        crumbs={[
          { label: 'DGLS', href: '/' },
          { label: 'Scrims', href: '/scrims' },
          { label: formatNightDate(match.night_date), href: scrimNightHref(match.night_date) },
          { label: `Match ${match.match_number}` },
        ]}
      />
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        <div
          className={`-mx-6 px-6 ${map ? 'map-card-bg light-boost' : 'map-no-img'}`}
          style={map ? ({ ['--map-img' as string]: mapImg ? `url("${mapImg}")` : 'none' } as React.CSSProperties) : undefined}
        >
          <div className="pt-8 pb-6">
            <MatchScoreHero
              matchId={match.id}
              played={played}
              vetoComplete={ready}
              finalScore={score}
              mapHref={map ? mapSidesHref(map) : null}
              shirtsF={shirtsF}
              skinsF={skinsStartingSide}
            />
          </div>
          {!played && (
            <div className="pb-6 flex justify-center">
              <div className="w-full max-w-md">
                <MatchServerPanel matchId={match.id} canManage={canManage} initialState={serverState} />
              </div>
            </div>
          )}
          {canManage && (
            <div className="pb-6 flex justify-center">
              <div className="w-full max-w-md">
                <MatchDemoReviewBlock matchId={match.id} />
              </div>
            </div>
          )}
        </div>

        {played && match.round_history && <RoundHistoryStrip rounds={match.round_history} targetWinRounds={SCRIM_TARGET_WIN_ROUNDS} />}

        <Suspense>
          <UrlStateProvider>
            <MatchTabView
              shirts={shirts}
              skins={skins}
              score={score}
              shirtsWon={shirtsWon}
              shirtsF={shirtsF}
              skinsF={skinsStartingSide}
              mvpPlayerId={matchMvpPlayerId(stats, played)}
              currentPlayerId={currentPlayerId}
              played={played}
              canEnterResults={canManage && ready && (!played || isAdmin)}
              isCurrentUserAdmin={isAdmin}
              matchId={match.id}
              matchPlayers={stats.map((s) => ({ player_id: s.player_id, player_name: s.player_name, faction: s.faction as 'SHIRTS' | 'SKINS' }))}
              targetWinRounds={SCRIM_TARGET_WIN_ROUNDS}
              skinsSide={skinsStartingSide}
              sabremetrics={facts.sabremetrics}
              matchKills={facts.matchKills}
              matchDamageEvents={facts.matchDamageEvents}
              matchWeaponClassStats={facts.matchWeaponClassStats}
              matchEconomyStats={facts.matchEconomyStats}
              matchRoundEconomy={facts.matchRoundEconomy}
              roundHistory={match.round_history ?? []}
              ehog={{ deltas: {}, projections: [], current: {} }}
              scouting={{ data: null, h2h: null }}
              mapInfo={{ map, matchIds: [], pool: null }}
              recap={{
                demoDownloadUrl: facts.demoDownloadUrl,
                job: facts.replayJob,
                events: facts.replayEvents,
                recordingURL: match.recording_url,
                isMultiSegmentDemo: facts.isMultiSegmentDemo,
              }}
            />
          </UrlStateProvider>
        </Suspense>
      </main>
    </div>
  );
}
