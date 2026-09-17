import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import type { Metadata } from 'next';
import { TopbarShell } from '@/components/TopbarShell';
import {
  getSeason,
  getSeasonLeaderboard,
  getSeasonMatchSummaries,
  getSeasonRoster,
  getPlayersById,
  hasSeasonScheduleDraft,
  getGauntletRounds,
  getGauntletBracketShape,
  getGauntletSeasonProgress,
  deriveGauntletSeasonLeaderboard,
  getLinkedGauntlet,
  getLinkedRegularSeason,
  getRegularSeasonHeavyView,
  getGauntletSeasonHeavyView,
  getSeasonEhogRatings,
  getAllSabremetrics,
  getAllMatchRounds,
  getAllMatchKills,
  getAllWeaponClassStats,
  getAllEconomyStats,
  type RegularSeasonHeavyView,
  type GauntletSeasonHeavyView,
  type GauntletRound,
} from '@/lib/queries';
import { computeH2H, gauntletRoundsToH2HInput } from '@/lib/h2h';
import SeasonTabView from '@/components/SeasonTabView';
import CombinedSeasonTabView from '@/components/CombinedSeasonTabView';
import { UrlStateProvider } from '@/components/UrlStateProvider';
import type { Season } from '@/lib/types';
import SeasonStartDateButton from '@/components/SeasonStartDateButton';
import MarkSeasonActiveButton from '@/components/MarkSeasonActiveButton';
import { SeasonRosterPanel } from '@/components/SeasonRosterPanel';
import { SeasonScheduleEntryPoint } from '@/components/SeasonScheduleEntryPoint';
import { authOptions } from '@/lib/authOptions';
import { seasonTitle, weekWindow, matchTitle, extractSeasonNumber } from '@/lib/util';
import { buildSeasonJsonLd } from '@/lib/seo/structured-data';
import { JsonLd } from '@/components/JsonLd';

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const seasonId = Number(id);
  const season = await getSeason(seasonId);
  if (!season) return { title: 'Season' };

  const title = seasonTitle(season.name);
  const statusLabel = season.status === 'ACTIVE' ? ' · Live' : season.status === 'UPCOMING' ? ' · Soon' : '';
  const description = `${title}${statusLabel} — standings, schedule, and match results in DGLS.`;

  return {
    title: season.name,
    description,
    alternates: { canonical: `/seasons/${seasonId}` },
    openGraph: {
      title: `DGLS · ${title}`,
      description,
    },
    twitter: {
      card: 'summary_large_image',
      title: `DGLS · ${title}`,
      description,
    },
  };
}

function countGauntletMatches(rounds: GauntletRound[]) {
  return rounds.reduce((sum, r) => sum + r.matches.length, 0);
}

/** The last calendar day of a season's final week/round, derived from its week-numbering scheme. */
function seasonEndDate(startDate: string | null, finalWeekNumber: number | null): string | null {
  if (finalWeekNumber == null) return null;
  const window = weekWindow(startDate, finalWeekNumber);
  return window ? window.end.toISOString().slice(0, 10) : null;
}

function Topbar({ season }: { season: Season }) {
  return (
    <TopbarShell
      crumbs={[
        { label: 'DGLS', href: '/' },
        { label: seasonTitle(season.name) },
      ]}
    />
  );
}

function SeasonStatusTag({ status }: { status: Season['status'] }) {
  if (status === 'ACTIVE') {
    return (
      <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 tracked text-[10px] font-semibold text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] border border-[var(--color-accent-green-border)] shrink-0">
        <span className="live-dot w-1.5 h-1.5 rounded-full bg-[var(--color-accent-green-fill)]" />
        Live
      </span>
    );
  }
  if (status === 'UPCOMING') {
    return (
      <span
        className="inline-flex items-center px-1.5 py-0.5 tracked text-[10px] font-semibold border shrink-0"
        style={{
          color: 'var(--color-site-accent)',
          background: 'color-mix(in srgb, var(--color-site-accent) 12%, transparent)',
          borderColor: 'var(--color-site-accent)',
        }}
      >
        Soon
      </span>
    );
  }
  return null;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SeasonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) notFound();

  // Which of the Regular Season / Gauntlet tabs to eagerly render server-side — the other tab's own
  // heavy data is fetched lazily, client-side, the first time it's actually opened (see
  // CombinedSeasonTabView). Read from the URL so a direct `?view=gauntlet` link still renders that
  // tab on the first paint, with no client-side flash/refetch.
  const initialView: 'regular' | 'gauntlet' = (await searchParams).view === 'gauntlet' ? 'gauntlet' : 'regular';

  // Independent reads — neither depends on the other's result, so they run together instead of
  // stacking as sequential round trips.
  const [season, session] = await Promise.all([
    getSeason(seasonId),
    getServerSession(authOptions),
  ]);
  if (!season) notFound();

  const currentPlayerId = session?.user?.playerId ?? null;

  if (season.is_gauntlet) {
    const linked = await getLinkedRegularSeason(season.name);
    if (linked) redirect(`/seasons/${linked.id}`);

    // Orphan gauntlet with no paired regular season — render standalone. `getPlayersById()` is
    // `cache()`-wrapped and reused below (h2hData) with zero additional query — fetched here rather
    // than earlier so a season that redirects above never pays for it at all.
    const [rounds, bracketShape, ehogRatings, sabremetrics, matchRounds, matchKills, matchWeaponClassStats, matchEconomyStats, playersById] = await Promise.all([
      getGauntletRounds(seasonId),
      getGauntletBracketShape(seasonId),
      getSeasonEhogRatings(seasonId),
      getAllSabremetrics(seasonId),
      getAllMatchRounds(seasonId),
      getAllMatchKills(seasonId),
      getAllWeaponClassStats(seasonId),
      getAllEconomyStats(seasonId),
      getPlayersById(),
    ]);
    const isAdmin = currentPlayerId != null ? !!playersById.get(currentPlayerId)?.is_admin : false;
    // Derived from `rounds` — already fetched above — instead of a second, redundant
    // getGauntletSeasonLeaderboard() round trip over the same matches.
    const leaderboard = deriveGauntletSeasonLeaderboard(rounds, seasonId, playersById);
    // Computed from `rounds` — already fetched above for the Rounds tab — instead of a second,
    // redundant getH2HData() round-trip over the same matches (see #441).
    const h2hData = computeH2H(gauntletRoundsToH2HInput(rounds, extractSeasonNumber(season.name)), playersById);
    const matchCount = countGauntletMatches(rounds);
    const finalRound = rounds.length > 0 ? rounds[rounds.length - 1].round_number : null;
    const seasonJsonLd = buildSeasonJsonLd({
      seasonId: season.id,
      seasonTitle: seasonTitle(season.name),
      startDate: season.start_date,
      endDate: seasonEndDate(season.start_date, finalRound),
      matches: rounds.flatMap((r) =>
        r.matches.map((m) => ({
          id: m.id,
          name: matchTitle({ seasonName: season.name, weekNumber: r.round_number, matchNumber: m.match_number, isGauntlet: true }),
          startDate: null,
        })),
      ),
    });

    return (
      <div className="min-h-screen">
        <JsonLd data={seasonJsonLd} />
        <Topbar season={season} />
        <main className="max-w-[1080px] mx-auto px-6 pb-16">
          <div className="mt-8 mb-6">
            <div className="flex items-center gap-3">
              <SeasonStatusTag status={season.status} />
              <div className="font-display text-[36px] font-semibold leading-tight">
                {seasonTitle(season.name)}
              </div>
            </div>
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1.5">
              {matchCount} matches · {rounds.length} rounds
            </div>
            <div className="mt-2">
              <SeasonStartDateButton
                seasonId={season.id}
                startDate={season.start_date}
                canEdit={isAdmin && season.status !== 'ARCHIVED'}
                seasonStatus={season.status}
              />
            </div>
          </div>
          <Suspense>
            <UrlStateProvider>
              <SeasonTabView
                kind="gauntlet"
                rounds={rounds}
                bracketShape={bracketShape}
                leaderboard={leaderboard}
                seasonStatus={season.status}
                currentPlayerId={currentPlayerId}
                h2hData={h2hData}
                ehogRatings={ehogRatings}
                sabremetrics={sabremetrics}
                matchRounds={matchRounds}
                matchKills={matchKills}
                matchWeaponClassStats={matchWeaponClassStats}
                matchEconomyStats={matchEconomyStats}
              />
            </UrlStateProvider>
          </Suspense>
        </main>
      </div>
    );
  }

  // Regular season — check for paired gauntlet. `leaderboard` and `matchSummaries` are both light
  // (the latter deliberately so — see getSeasonMatchSummaries()'s own doc comment) and needed
  // regardless of which tab ends up showing, so they're fetched eagerly here alongside
  // `linkedGauntlet`/`playersById` rather than folded into either tab's own heavy view.
  const [linkedGauntlet, playersById, leaderboard, matchSummaries] = await Promise.all([
    getLinkedGauntlet(season.name),
    getPlayersById(),
    getSeasonLeaderboard(seasonId),
    getSeasonMatchSummaries(seasonId),
  ]);
  const isAdmin = currentPlayerId != null ? !!playersById.get(currentPlayerId)?.is_admin : false;
  const isUpcoming = season.status === 'UPCOMING';
  const seasonNumber = extractSeasonNumber(season.name);

  // The paired gauntlet's light cross-link data (bracket shape, seeded/started) plus this page's
  // other light reads, all independent of each other — together with the heavy view for whichever
  // tab `initialView` names (the other tab's heavy view is fetched lazily, client-side, once it's
  // actually opened — see CombinedSeasonTabView).
  const [gauntletBracketShape, gauntletSeasonProgress, hasSchedule, roster, initialHeavy] = await Promise.all([
    linkedGauntlet ? getGauntletBracketShape(linkedGauntlet.id) : Promise.resolve([]),
    linkedGauntlet ? getGauntletSeasonProgress(linkedGauntlet.id) : Promise.resolve({ seeded: false, started: false }),
    isUpcoming && isAdmin ? hasSeasonScheduleDraft(seasonId) : Promise.resolve(false),
    isUpcoming ? getSeasonRoster(seasonId, playersById) : Promise.resolve([]),
    initialView === 'gauntlet' && linkedGauntlet
      ? getGauntletSeasonHeavyView(linkedGauntlet.id, seasonNumber, playersById)
      : getRegularSeasonHeavyView(seasonId, seasonNumber, playersById),
  ]);

  // A paired gauntlet season row can exist with no bracket shape yet (manual shell) and no seeded
  // matches, in which case it's indistinguishable from having no gauntlet at all — not worth a tab.
  const showGauntletTab = !!linkedGauntlet && (gauntletBracketShape.length > 0 || gauntletSeasonProgress.seeded);

  let initialHeavyData: { kind: 'regular'; data: RegularSeasonHeavyView } | { kind: 'gauntlet'; data: GauntletSeasonHeavyView } =
    initialView === 'gauntlet' && linkedGauntlet
      ? { kind: 'gauntlet', data: initialHeavy as GauntletSeasonHeavyView }
      : { kind: 'regular', data: initialHeavy as RegularSeasonHeavyView };
  // Rare fallback: a `?view=gauntlet` link landed on a season whose linked gauntlet turns out to
  // have no real content to show a tab for — fetch the regular view actually needed to render
  // instead. Never reached on a normal page load (only a stale/bogus `view` param takes this path).
  if (!showGauntletTab && initialHeavyData.kind === 'gauntlet') {
    initialHeavyData = { kind: 'regular', data: await getRegularSeasonHeavyView(seasonId, seasonNumber, playersById) };
  }

  const matchCount = matchSummaries.matches.length;
  const finalWeek = matchSummaries.matches.length > 0
    ? Math.max(...matchSummaries.matches.map((m) => m.week_number))
    : null;
  const seasonJsonLd = buildSeasonJsonLd({
    seasonId: season.id,
    seasonTitle: seasonTitle(season.name),
    startDate: season.start_date,
    endDate: seasonEndDate(season.start_date, finalWeek),
    matches: matchSummaries.matches.map((m) => ({
      id: m.id,
      name: matchTitle({ seasonName: season.name, weekNumber: m.week_number, matchNumber: m.match_number, isGauntlet: false }),
      startDate: m.scheduled_at,
    })),
  });

  const regularHeavy = initialHeavyData.kind === 'regular' ? initialHeavyData.data : null;

  return (
    <div className="min-h-screen">
      <JsonLd data={seasonJsonLd} />
      <Topbar season={season} />
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <div className="flex items-center gap-3">
            <SeasonStatusTag status={season.status} />
            <div className="font-display text-[36px] font-semibold leading-tight">
              {seasonTitle(season.name)}
            </div>
          </div>
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1.5">
            {leaderboard.length} players · {matchCount} matches · {matchSummaries.weekCount} weeks
          </div>
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <SeasonStartDateButton
              seasonId={season.id}
              startDate={season.start_date}
              canEdit={isAdmin && season.status !== 'ARCHIVED'}
              seasonStatus={season.status}
            />
            <MarkSeasonActiveButton
              seasonId={season.id}
              canEdit={isAdmin}
              seasonStatus={season.status}
            />
          </div>
        </div>
        {isUpcoming && (
          <div className="mb-10 flex flex-col gap-3">
            <SeasonRosterPanel
              seasonId={season.id}
              roster={roster}
              allPlayers={Array.from(playersById.values()).map((p) => ({ id: p.id, name: p.name }))}
              isAdmin={isAdmin}
              currentPlayerId={currentPlayerId}
            />
            {isAdmin && <SeasonScheduleEntryPoint seasonId={season.id} hasSchedule={hasSchedule} />}
          </div>
        )}
        <Suspense>
          <UrlStateProvider>
            {showGauntletTab && linkedGauntlet ? (
              <CombinedSeasonTabView
                leaderboard={leaderboard}
                seasonStartDate={season.start_date}
                seasonStatus={season.status}
                mapPool={season.map_pool}
                gauntletBracketShape={gauntletBracketShape}
                gauntletStatus={linkedGauntlet.status}
                gauntletStarted={gauntletSeasonProgress.started}
                currentPlayerId={currentPlayerId}
                isAdmin={isAdmin}
                regularSeasonId={season.id}
                gauntletSeasonId={linkedGauntlet.id}
                seasonNumber={seasonNumber}
                initialView={initialView}
                initialHeavyData={initialHeavyData}
              />
            ) : (
              // `showGauntletTab` false guarantees `initialHeavyData.kind === 'regular'` — either
              // there was never a gauntlet-kind fetch to begin with, or the fallback above already
              // replaced it with one.
              <SeasonTabView
                kind="regular"
                leaderboard={leaderboard}
                schedule={regularHeavy!.schedule}
                seasonStartDate={season.start_date}
                seasonStatus={season.status}
                mapPool={season.map_pool}
                currentPlayerId={currentPlayerId}
                h2hData={regularHeavy!.h2hData}
                ehogRatings={regularHeavy!.ehogRatings}
                sabremetrics={regularHeavy!.sabremetrics}
                matchRounds={regularHeavy!.matchRounds}
                matchKills={regularHeavy!.matchKills}
                matchWeaponClassStats={regularHeavy!.matchWeaponClassStats}
                matchEconomyStats={regularHeavy!.matchEconomyStats}
              />
            )}
          </UrlStateProvider>
        </Suspense>
      </main>
    </div>
  );
}
