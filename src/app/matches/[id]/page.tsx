import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import type { Metadata } from 'next';
import { getMatch, getMatchScoutingData, getCareerH2HDataCached, getMatchRatingDeltas, getPlayerRatings, getMatchIdsForMap, getMatchServerState, getOtherScheduledMatches, getGauntletPodForMatch, getGauntletPodSibling, getSeasonScope, isWeekComplete, isMatchCurrentlyLive, weekWindowBoundaries, weekWindowMs } from '@/lib/queries';
import { loadMatchPageFacts, matchMvpPlayerId, shirtsFaction } from '@/lib/match-page-data';
import { getMatchMeta } from '@/lib/seo/og';
import { buildMatchJsonLd } from '@/lib/seo/structured-data';
import { JsonLd } from '@/components/JsonLd';
import { projectRatingDeltas, predictWinProbability, isProvisional, type RatingProjection } from '@/lib/ehog';
import { isPlayedScore, nextRefreshInstant, parseRouteId, parseScore } from '@/lib/util';
import { mapImageFor, mapSidesHref } from '@/lib/maps';
import { getMapLookup } from '@/lib/queries';
import { TopbarShell } from '@/components/TopbarShell';
import { buildCrumbs, scrimMatchHref } from '@/lib/crumbs';
import { isScrimMatch } from '@/lib/scrim-matches';
import { getAdminClient } from '@/lib/supabase-admin';
import MatchHeaderSection from '@/components/MatchHeaderSection';
import VetoSequence from '@/components/VetoSequence';
import MatchServerPanel from '@/components/MatchServerPanel';
import type { ServerState } from '@/lib/dathost-lifecycle';
import MatchDemoReviewBlock from '@/components/MatchDemoReviewBlock';
import { MatchMapBackdrop, MatchPanelSlot } from '@/components/MatchBackdrop';
import MatchScoreHero from '@/components/MatchScoreHero';
import MatchTabView from '@/components/MatchTabView';
import { UrlStateProvider } from '@/components/UrlStateProvider';
import RoundHistoryStrip from '@/components/RoundHistoryStrip';
import { WinProbabilityBar } from '@/components/WinProbabilityBar';
import { authOptions } from '@/lib/authOptions';
import { getPlayersById } from '@/lib/queries';
import { FeatureMatchBanner } from '@/components/FeatureMatch';
import { SchedulingOverlapBanner } from '@/components/SchedulingOverlapBanner';
import { findScheduleCollision } from '@/lib/server-schedule-collision';
import { isVetoComplete, isVetoWindowOpen, vetoWindowOpensAt, effectivePickedMap, effectiveSkinsStartingSide } from '@/lib/veto';
import { RefreshAt } from '@/components/RefreshAt';
import SectionLabel from '@/components/SectionLabel';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const matchId = parseRouteId(id);
  const meta = matchId === null ? null : await getMatchMeta(matchId);
  if (!meta) return { title: 'Match' };
  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: `/matches/${id}` },
    openGraph: {
      title: `DGLS · ${meta.title}`,
      description: meta.description,
    },
    twitter: {
      card: 'summary_large_image',
      title: `DGLS · ${meta.title}`,
      description: meta.description,
    },
  };
}

type Faction = 'CT' | 'T' | null;

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
  const matchId = parseRouteId(id);
  if (matchId === null) notFound();
  // getServerSession() depends on none of the match/map data — starts alongside them instead of
  // waiting for this batch to resolve first.
  const [detail, mapLookup, session] = await Promise.all([
    getMatch(matchId),
    getMapLookup(),
    getServerSession(authOptions),
  ]);
  if (!detail) {
    // A scrim match has no week, so `getMatch()` doesn't return it — it has its own page.
    if (await isScrimMatch(getAdminClient(), matchId)) redirect(scrimMatchHref(matchId));
    notFound();
  }

  const { match, week, season, stats } = detail;
  const played = isPlayedScore(match.final_score);

  const vetoComplete = isVetoComplete(match, season.is_gauntlet);
  const score = played ? parseScore(match.final_score) : null;
  const map = effectivePickedMap(match);
  const mapImg = mapImageFor(map, mapLookup);

  const shirts = stats.filter((s) => s.faction === 'SHIRTS');
  const skins = stats.filter((s) => s.faction === 'SKINS');

  const hasFull2v2Roster = shirts.length === 2 && skins.length === 2;
  // Once a match is played, its Scouting Report tab (pre-match career-history prep) gives way
  // to the H2H tab (this match's own actual matchups, computed below) — so the scouting fetches
  // are only worth making beforehand.
  const showPreMatchScouting = hasFull2v2Roster && !played;

  // Rating projections/win-probability render for an unplayed match either in its own week's date
  // window, or — if that window hasn't opened yet — once the previous week is fully scored (a
  // league that wraps a week up early shouldn't have to wait on the calendar for predictions).
  const now = new Date().getTime();
  const matchWindow = season.start_date ? weekWindowMs(season.start_date, week.week_number) : null;
  const isCurrentWeek = matchWindow != null && now >= matchWindow.start && now <= matchWindow.end;
  const needsPreviousWeekCheck =
    showPreMatchScouting && week.week_number > 1 && matchWindow != null && now < matchWindow.start;

  // A pod's sibling lookup needs the pod itself first — chained rather than a second query, since
  // both games share one `gauntlet_pods` row.
  const podPromise = season.is_gauntlet ? getGauntletPodForMatch(matchId) : Promise.resolve(null);
  const podSiblingPromise = podPromise.then((pod) => (pod ? getGauntletPodSibling(matchId, pod) : null));
  // Independent of podSiblingPromise (getOtherScheduledMatches() itself has no gauntlet awareness) —
  // the pod sibling it needs to exclude from the collision pool is filtered out below, once both
  // promises have resolved.
  const otherScheduledPromise = !played ? getOtherScheduledMatches(match.id) : Promise.resolve([]);

  // Pre-match win probability's player ratings — depends only on shirts/skins, both available
  // right after the first Promise.all, so it's folded into this batch instead of awaited
  // afterward. Whether the result is actually *used* still gates on the time-window check below
  // (previousWeekComplete, resolved in this same batch).
  const allScoutedPlayerIds = [...shirts, ...skins].map((s) => s.player_id);
  const playerRatingsPromise = showPreMatchScouting
    ? getPlayerRatings(allScoutedPlayerIds)
    : Promise.resolve([]);

  // The match server panel shows once the veto is done (always in dev) and the match is unplayed.
  const showServerPanel = !played && (vetoComplete || process.env.NODE_ENV === 'development');

  const [scope, pod, scoutingData, scoutingH2H, facts, ratingDeltaMap, mapMatchIds, podSibling, otherScheduledRaw, previousWeekComplete, isLiveNow, playerRatingsRows, serverState] = await Promise.all([
    getSeasonScope(season),
    podPromise,
    showPreMatchScouting ? getMatchScoutingData(matchId) : Promise.resolve(null),
    // Cached and shared across every match page (see #441 item 3) rather than a fresh
    // full-league computeH2H() scan on each load.
    showPreMatchScouting ? getCareerH2HDataCached() : Promise.resolve(null),
    loadMatchPageFacts(matchId, played),
    played ? getMatchRatingDeltas(matchId) : Promise.resolve(new Map<number, number>()),
    // Match ids on this map — feeds the scouting report's Map Intel heatmap (#128).
    showPreMatchScouting && map ? getMatchIdsForMap(map) : Promise.resolve<number[]>([]),
    podSiblingPromise,
    otherScheduledPromise,
    needsPreviousWeekCheck ? isWeekComplete(season.id, week.week_number - 1) : Promise.resolve(false),
    // Drives the `--ticker-h` override below — only an unplayed match can ever be the live one.
    played ? Promise.resolve(false) : isMatchCurrentlyLive(matchId),
    playerRatingsPromise,
    // The server panel's starting state for every viewer — non-managers can't call the status
    // route, and a server that is live all match may never fire another Realtime update.
    showServerPanel ? getMatchServerState(matchId) : Promise.resolve<ServerState>('idle'),
  ]);
  const ratingDeltas: Record<number, number> = Object.fromEntries(ratingDeltaMap);
  const { demoDownloadUrl, sabremetrics, matchKills, matchDamageEvents, matchWeaponClassStats, matchEconomyStats, matchRoundEconomy, replayJob, replayEvents, isMultiSegmentDemo } = facts;

  let ratingProjections: RatingProjection[] = [];
  const ratingCurrent: Record<number, number> = {};
  let winProbability: { pShirtsWin: number; provisional: boolean } | null = null;
  if (showPreMatchScouting && (isCurrentWeek || previousWeekComplete)) {
    const byId = new Map(playerRatingsRows.map((r) => [r.playerId, r]));
    const shirtRatings = shirts.map((s) => byId.get(s.player_id)!);
    const skinRatings = skins.map((s) => byId.get(s.player_id)!);
    ratingProjections = projectRatingDeltas(shirtRatings, skinRatings, season.target_win_rounds);
    for (const r of playerRatingsRows) ratingCurrent[r.playerId] = r.ehogRating;
    winProbability = {
      pShirtsWin: predictWinProbability(shirtRatings, skinRatings),
      provisional: isProvisional(shirtRatings, skinRatings),
    };
  }
  const postMatchWinProb = played ? match.pre_match_win_prob : null;

  const mvpPlayerId = matchMvpPlayerId(stats, played);

  const shirtsWon = score ? score.shirts > score.skins : false;
  const skinsStartingSide = effectiveSkinsStartingSide(match);
  const shirtsF = shirtsFaction(skinsStartingSide);
  const skinsF: Faction = skinsStartingSide;

  const currentPlayerId = session?.user?.playerId ?? null;

  // Veto window: open only once a scheduled time exists and `VETO_WINDOW_LEAD_MS` before it has passed
  const vetoWindowOpen = isVetoWindowOpen(match.scheduled_at, now);
  // The veto window opening, and the week window opening or closing (which gates the projections
  // above), happen on the clock, so an unplayed match's page refreshes itself at the next of them.
  const refreshAt = played
    ? null
    : nextRefreshInstant(
        [
          ...(match.scheduled_at ? [vetoWindowOpensAt(match.scheduled_at)] : []),
          ...(showPreMatchScouting && season.start_date ? weekWindowBoundaries(season.start_date, week.week_number) : []),
        ],
        now,
      );

  // Determine edit/veto permissions: admins or players in the match
  let canEdit = false;
  let canVeto = false;
  let canEnterResults = false;
  let playerFaction: 'SHIRTS' | 'SKINS' | null = null;
  let vetoIsAdmin = false;
  let isCurrentUserAdmin = false;
  let canManageServer = false; // admin or in-match → can start/stop the match server
  if (currentPlayerId !== null) {
    const myStatRow = stats.find((s) => s.player_id === currentPlayerId);
    const isInMatch = !!myStatRow;
    // `getPlayersById()` is `cache()`-wrapped and already fetched above (getMatch() calls it
    // internally to resolve `stats`' player names) — reusing it here costs zero additional query,
    // vs. the ad-hoc `players` lookup this replaces.
    const playersById = await getPlayersById();
    const isAdmin = !!playersById.get(currentPlayerId)?.is_admin;
    isCurrentUserAdmin = isAdmin;
    const authorized = isInMatch || isAdmin;
    canManageServer = authorized;
    if (authorized && !played) {
      // Non-admins are blocked from veto until the window opens
      canVeto = isAdmin || vetoWindowOpen;
      vetoIsAdmin = isAdmin;
      // Scheduling rights apply to both regular and gauntlet matches — a pod's Game 1 and Game 2 are
      // each independently editable here (PATCH /api/matches/[id]/schedule only auto-derives Game 2
      // from Game 1 when the time comes from a synced Discord Scheduled Event).
      canEdit = true;
      if (myStatRow) {
        playerFaction = myStatRow.faction as 'SHIRTS' | 'SKINS';
      }
    }
    // Can enter results: veto complete + (in match or admin). Admins can also edit after played.
    if (authorized && vetoComplete && (!played || isAdmin)) {
      canEnterResults = true;
    }
  }

  const crumbs = buildCrumbs({
    season: scope.hub,
    gauntlet: season.is_gauntlet,
    week: season.is_gauntlet ? undefined : { id: week.id, number: week.week_number },
    round: season.is_gauntlet ? week.week_number : undefined,
    group: pod ? { id: pod.id, podIndex: pod.pod_index, isFinal: pod.is_final } : undefined,
    leaf: pod ? `Game ${pod.match1_id === matchId ? 1 : 2}` : `Match ${match.match_number}`,
  });
  const window = matchWeekWindow(season.start_date, week.week_number);

  // Other unplayed matches' scheduled times, for the single-server scheduling-collision warning
  // (#134) — both the schedule editor and the overlap banner. Fetched for any viewer of an unplayed
  // match, gauntlet included, so the banner shows regardless of edit rights; a gauntlet match's own
  // pod sibling is excluded here (not inside getOtherScheduledMatches, which stays gauntlet-agnostic)
  // since the pod's two games are meant to be scheduled close together for one session — a synced
  // Discord Scheduled Event always puts them exactly `POD_GAME_GAP_MS` apart, well inside the
  // collision window, and a manual edit keeping them close is the same intended shape, not a
  // double-booking the way two unrelated matches contending for the server would be.
  const otherScheduled = otherScheduledRaw.filter((r) => r.id !== podSibling?.matchId);
  const scheduleCollision = findScheduleCollision(match.scheduled_at, otherScheduled);

  const matchJsonLd = buildMatchJsonLd({
    matchId: match.id,
    seasonName: season.name,
    weekNumber: week.week_number,
    isGauntlet: season.is_gauntlet,
    matchNumber: match.match_number,
    scheduledAt: match.scheduled_at,
    played,
    score,
    recordingUrl: match.recording_url,
    shirts,
    skins,
  });

  return (
    <div className="min-h-screen">
      {/* `LiveMatchTicker` suppresses itself here (it already knows this is its own match's page via
          `usePathname`), but the root layout can't know that server-side — it has no route params to
          check without opting the whole site out of static rendering — so it always reserves ticker
          space based on "is anything live" alone. `!important` corrects that guess before first paint
          instead of leaving it to the client to fix after hydration, which would show a phantom gap
          under the topbar on exactly the page most likely to be watched live. */}
      {isLiveNow && <style>{':root{--ticker-h:0px !important}'}</style>}
      <JsonLd data={matchJsonLd} />
      {refreshAt && <RefreshAt iso={refreshAt} />}
      <div className="centering">
        {match.is_feature_match && <FeatureMatchBanner />}
        {scheduleCollision && <SchedulingOverlapBanner conflict={scheduleCollision} />}
      </div>
      <TopbarShell crumbs={crumbs} />
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        {/* Header + veto wrapped in map backdrop — gradient shows regardless of image */}
        <MatchMapBackdrop map={map} mapImg={mapImg}>
          <div className="pt-8 pb-6">
            <MatchHeaderSection
              map={map}
              matchId={match.id}
              scheduledAt={match.scheduled_at}
              weekStart={window?.weekStart ?? null}
              weekEnd={window?.weekEnd ?? null}
              canEdit={canEdit}
              played={played}
              podSibling={podSibling}
              otherScheduled={otherScheduled}
            />

            <MatchScoreHero
              matchId={match.id}
              played={played}
              vetoComplete={vetoComplete}
              finalScore={score}
              mapHref={map ? mapSidesHref(map) : null}
              shirtsF={shirtsF}
              skinsF={skinsF}
            />

            {(winProbability || postMatchWinProb != null) && (
              <WinProbabilityBar
                pShirtsWin={played ? postMatchWinProb! : winProbability!.pShirtsWin}
                shirtsF={shirtsF}
                skinsF={skinsF}
                provisional={winProbability?.provisional ?? false}
                played={played}
                shirtsWon={shirtsWon}
              />
            )}
          </div>

          {(played || vetoIsAdmin || vetoWindowOpen) && (
            <>
              <div className="mb-3">
                <SectionLabel as="span" className="map-text-scrim">Map pick/ban</SectionLabel>
              </div>
              <div className="pb-6">
                <VetoSequence
                  match={match}
                  mapPool={season.map_pool}
                  canVeto={canVeto}
                  isGauntlet={season.is_gauntlet}
                  playerFaction={playerFaction}
                  isAdmin={vetoIsAdmin}
                />
              </div>
            </>
          )}

          {/* Match server — below pick/ban, still in the header. Always shown in dev.
              Hidden once the match has a final score — a scored match doesn't need a server,
              whether or not it went through the demo pipeline (#140). */}
          {showServerPanel && (
            <MatchPanelSlot>
              <MatchServerPanel matchId={match.id} canManage={canManageServer} autoProvisioning={vetoComplete} initialState={serverState} />
            </MatchPanelSlot>
          )}

          {/* Pending demo result — admin/in-match review & confirm; self-hides when none. */}
          {canManageServer && (
            <MatchPanelSlot>
              <MatchDemoReviewBlock matchId={match.id} />
            </MatchPanelSlot>
          )}

        </MatchMapBackdrop>

        {played && match.round_history && (
          <RoundHistoryStrip
            rounds={match.round_history}
            targetWinRounds={season.target_win_rounds}
            otRoundsPerHalf={match.ot_rounds_per_half}
          />
        )}

        <Suspense>
          <UrlStateProvider>
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
              otRoundsPerHalf={match.ot_rounds_per_half}
              skinsSide={skinsStartingSide}
              sabremetrics={sabremetrics}
              matchKills={matchKills}
              matchDamageEvents={matchDamageEvents}
              matchWeaponClassStats={matchWeaponClassStats}
              matchEconomyStats={matchEconomyStats}
              matchRoundEconomy={matchRoundEconomy}
              roundHistory={match.round_history ?? []}
              ehog={{ deltas: ratingDeltas, projections: ratingProjections, current: ratingCurrent }}
              scouting={{ data: scoutingData, h2h: scoutingH2H }}
              mapInfo={{ map, matchIds: mapMatchIds, pool: season.map_pool }}
              recap={{ demoDownloadUrl, job: replayJob, events: replayEvents, recordingURL: match.recording_url, isMultiSegmentDemo }}
            />
          </UrlStateProvider>
        </Suspense>
      </main>
    </div>
  );
}
