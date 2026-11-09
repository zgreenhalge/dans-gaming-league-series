import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import MatchScoreHero from '@/components/MatchScoreHero';
import MatchServerPanel from '@/components/MatchServerPanel';
import MatchDemoReviewBlock from '@/components/MatchDemoReviewBlock';
import { MatchMapBackdrop, MatchPanelSlot } from '@/components/MatchBackdrop';
import MatchTabView from '@/components/MatchTabView';
import RoundHistoryStrip from '@/components/RoundHistoryStrip';
import { UrlStateProvider } from '@/components/UrlStateProvider';
import { getSession } from '@/lib/session';
import { getMapLookup, getMatchServerState, getPlayersById, getScrimMatchDetail } from '@/lib/queries';
import { loadMatchPageFacts, matchMvpPlayerId, shirtsFaction } from '@/lib/match-page-data';
import { scrimNightHref } from '@/lib/crumbs';
import { LocalDateInTitle } from '@/components/LocalDateInTitle';
import { effectivePickedMap, effectiveSkinsStartingSide } from '@/lib/veto';
import { mapImageFor, mapSidesHref } from '@/lib/maps';
import { formatLeagueDate, isPlayedScore, parseRouteId, parseScore } from '@/lib/util';
import { DEFAULT_TARGET_WIN_ROUNDS } from '@/lib/replay/inputs';

// The server panel's state and the lobby's lock change live; don't cache.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const matchId = parseRouteId((await params).id);
  const match = matchId === null ? null : await getScrimMatchDetail(matchId);
  return { title: match ? `Scrim · ${formatLeagueDate(match.night_starts_at)} · Match ${match.match_number}` : 'Scrim match' };
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

  const nightLabel = formatLeagueDate(match.night_starts_at);
  const currentPlayerId = session?.user?.playerId ?? null;
  const isAdmin = currentPlayerId != null && !!playersById.get(currentPlayerId)?.is_admin;
  const canManage = currentPlayerId != null && (isAdmin || stats.some((s) => s.player_id === currentPlayerId));

  return (
    <div className="min-h-screen">
      <LocalDateInTitle iso={match.night_starts_at} serverLabel={nightLabel} />
      <TopbarShell
        crumbs={[
          { label: 'DGLS', href: '/' },
          { label: 'Scrims', href: '/scrims' },
          { label: nightLabel, localDate: match.night_starts_at, href: scrimNightHref(match.night_id) },
          { label: `Match ${match.match_number}` },
        ]}
      />
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        <MatchMapBackdrop map={map} mapImg={mapImg}>
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
            <MatchPanelSlot>
              <MatchServerPanel matchId={match.id} canManage={canManage} canJoin={currentPlayerId != null} signInToJoin={currentPlayerId == null} initialState={serverState} />
            </MatchPanelSlot>
          )}
          {canManage && (
            <MatchPanelSlot>
              <MatchDemoReviewBlock matchId={match.id} />
            </MatchPanelSlot>
          )}
        </MatchMapBackdrop>

        {played && match.round_history && <RoundHistoryStrip rounds={match.round_history} targetWinRounds={DEFAULT_TARGET_WIN_ROUNDS} otRoundsPerHalf={match.ot_rounds_per_half} />}

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
              targetWinRounds={DEFAULT_TARGET_WIN_ROUNDS}
              otRoundsPerHalf={match.ot_rounds_per_half}
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
