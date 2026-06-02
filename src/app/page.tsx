import Link from 'next/link';
import { getSeasons, getAllLeaderboards, getAllGauntletSummaries, getGauntletStats } from '@/lib/queries';
import type { GauntletSummary } from '@/lib/queries';
import type { LeaderboardRowWithId, Season } from '@/lib/types';
import { TopbarShell } from '@/components/TopbarShell';
import PlayerAvatar from '@/components/PlayerAvatar';
import { seasonTitle, extractSeasonNumber } from '@/lib/util';

export const dynamic = 'force-dynamic';

function podiumSort(rows: LeaderboardRowWithId[]): LeaderboardRowWithId[] {
  return [...rows].sort(
    (a, b) =>
      b.win_rate_percentage - a.win_rate_percentage ||
      b.rwr_percentage - a.rwr_percentage,
  );
}


function HomeTopbar() {
  return <TopbarShell crumbs={[{ label: 'DGLS' }]} />;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="tracked text-[10px] text-[var(--color-text-secondary)] mt-10 mb-3 first:mt-2">
      {children}
    </div>
  );
}

function ActiveSeasonPanel({
  season,
  leaderboard,
}: {
  season: Season;
  leaderboard: LeaderboardRowWithId[];
}) {
  const sorted = podiumSort(leaderboard);
  const hasData = sorted.length > 0 && sorted[0].matches_played > 0;
  const top3 = sorted.slice(0, 3);

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <Link
        href={`/seasons/${season.id}`}
        className="block px-6 py-5 border-b border-[var(--color-border-tertiary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 tracked text-[10px] font-semibold text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] border border-[var(--color-accent-green-border)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-green-fill)] animate-pulse" />
            Live
          </span>
        </div>
        <div className="font-display text-[32px] font-semibold leading-tight text-[var(--color-text-primary)]">
          {seasonTitle(season.name)}
        </div>
        <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1.5">
          {leaderboard.length} players
        </div>
      </Link>

      {hasData ? (
        <div className="grid grid-cols-3">
          {top3.map((p, i) => (
            <Link
              key={p.player_id}
              href={`/players/${p.player_id}`}
              className="block px-5 py-4 border-r border-[var(--color-border-tertiary)] last:border-r-0 hover:bg-[var(--color-bg-secondary)] transition-colors"
            >
              <div className="flex items-center gap-3 mb-2">
                <PlayerAvatar name={p.player_name} imageUrl={null} size="sm" />
                <div className="tracked text-[9px] text-[var(--color-text-secondary)]">
                  {i === 0 ? 'Leader' : i === 1 ? '2nd' : '3rd'}
                </div>
              </div>
              <div className="font-display text-[18px] font-semibold leading-tight truncate">
                {p.player_name}
              </div>
              <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-1.5 flex items-center gap-3">
                <span>
                  <span className="text-[var(--color-text-primary)] font-semibold">
                    {p.overall_adr.toFixed(1)}
                  </span>
                  <span className="ml-1">ADR</span>
                </span>
                <span>{p.win_rate_percentage.toFixed(1)}% WR</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="px-6 py-5 font-mono text-[12px] text-[var(--color-text-secondary)]">
          No matches played yet.
        </div>
      )}
    </div>
  );
}

function UpcomingSeasonRow({
  season,
  leaderboard,
}: {
  season: Season;
  leaderboard: LeaderboardRowWithId[];
}) {
  return (
    <Link
      href={`/seasons/${season.id}`}
      className="flex items-center justify-between gap-6 px-5 py-4 border-b border-[var(--color-border-tertiary)] last:border-b-0 hover:bg-[var(--color-bg-secondary)] transition-colors"
    >
      <div className="min-w-0">
        <div className="tracked text-[9px] mb-0.5" style={{ color: 'var(--color-site-accent)' }}>
          Upcoming
        </div>
        <div className="font-display text-[18px] font-semibold leading-tight truncate">
          {seasonTitle(season.name)}
        </div>
        <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-1">
          {[
            leaderboard.length > 0 && `${leaderboard.length} players`,
            season.start_date && new Date(season.start_date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
          ].filter(Boolean).join(' · ')}
        </div>
      </div>
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
    </Link>
  );
}

function PastSeasonRow({
  season,
  leaderboard,
}: {
  season: Season;
  leaderboard: LeaderboardRowWithId[];
}) {
  const sorted = podiumSort(leaderboard);
  const winner = sorted[0];

  return (
    <Link
      href={`/seasons/${season.id}`}
      className="grid grid-cols-[1fr_auto] items-center gap-8 px-5 py-4 border-b border-[var(--color-border-tertiary)] last:border-b-0 hover:bg-[var(--color-bg-secondary)] transition-colors"
    >
      <div className="min-w-0">
        <div className="font-display text-[18px] font-semibold leading-tight truncate">
          {seasonTitle(season.name)}
        </div>
        <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-1">
          {leaderboard.length} players
        </div>
      </div>
      {winner ? (
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <span className="tracked text-[9px] text-[var(--color-text-secondary)]">Champion</span>
            <span className="font-display text-[16px] font-semibold leading-tight">{winner.player_name}</span>
            <PlayerAvatar name={winner.player_name} imageUrl={null} size="sm" />
          </div>
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)] flex items-center gap-5">
            <Stat v={`${winner.win_rate_percentage.toFixed(1)}%`} l="WR" />
            <Stat v={winner.overall_adr.toFixed(1)} l="ADR" />
            <Stat v={winner.kd_ratio.toFixed(2)} l="K/D" />
          </div>
        </div>
      ) : (
        <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">No data</div>
      )}
    </Link>
  );
}

// Orphan gauntlet with no paired regular season
function GauntletPastSeasonRow({
  season,
  summary,
}: {
  season: Season;
  summary: GauntletSummary | undefined;
}) {
  return (
    <Link
      href={`/seasons/${season.id}`}
      className="grid grid-cols-[1fr_auto] items-center gap-8 px-5 py-4 border-b border-[var(--color-border-tertiary)] last:border-b-0 hover:bg-[var(--color-bg-secondary)] transition-colors"
    >
      <div className="min-w-0">
        <div className="font-display text-[18px] font-semibold leading-tight truncate">
          {seasonTitle(season.name)}
        </div>
        <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-1">
          {summary ? `${summary.playerCount} players · ${summary.roundCount} rounds` : 'Gauntlet'}
        </div>
      </div>
      {summary?.champion ? (
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <span className="tracked text-[9px] text-[var(--color-text-secondary)]">Champion</span>
            <span className="font-display text-[16px] font-semibold leading-tight">{summary.champion.name}</span>
            <PlayerAvatar name={summary.champion.name} imageUrl={null} size="sm" />
          </div>
        </div>
      ) : (
        <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">No data</div>
      )}
    </Link>
  );
}

function CombinedPastSeasonRow({
  regularSeason,
  leaderboard,
  gauntletSummary,
  gauntletLeaderboard,
}: {
  regularSeason: Season;
  leaderboard: LeaderboardRowWithId[];
  gauntletSummary: GauntletSummary | undefined;
  gauntletLeaderboard: LeaderboardRowWithId[];
}) {
  const regWinner = podiumSort(leaderboard)[0] ?? null;
  const gauntletChampion = gauntletSummary?.champion ?? null;
  const gauntletChampionStats = gauntletChampion
    ? (gauntletLeaderboard.find((r) => r.player_id === gauntletChampion.player_id) ?? null)
    : null;

  return (
    <Link
      href={`/seasons/${regularSeason.id}`}
      className="flex flex-col sm:grid sm:grid-cols-[1fr_auto] sm:items-center gap-3 sm:gap-8 px-5 py-4 border-b border-[var(--color-border-tertiary)] last:border-b-0 hover:bg-[var(--color-bg-secondary)] transition-colors"
    >
      <div className="min-w-0">
        <div className="font-display text-[18px] font-semibold leading-tight truncate">
          {seasonTitle(regularSeason.name)}
        </div>
        <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-1">
          {leaderboard.length} players
        </div>
      </div>
      <div className="flex flex-wrap sm:flex-nowrap items-start sm:items-center gap-4 sm:gap-8">
        {regWinner ? (
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              <span className="tracked text-[9px] text-[var(--color-text-secondary)] text-right leading-tight">Regular Season<br />Winner</span>
              <span className="font-display text-[16px] font-semibold leading-tight">{regWinner.player_name}</span>
              <PlayerAvatar name={regWinner.player_name} imageUrl={null} size="sm" />
            </div>
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)] flex items-center gap-5">
              <Stat v={regWinner.kd_ratio.toFixed(2)} l="K/D" />
              <Stat v={regWinner.overall_adr.toFixed(1)} l="ADR" />
            </div>
          </div>
        ) : (
          <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">No season data</div>
        )}
        <div className="hidden sm:block w-px self-stretch bg-[var(--color-border-tertiary)]" />
        {gauntletChampion ? (
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              <span className="tracked text-[9px] text-[var(--color-text-secondary)] text-right leading-tight">Gauntlet<br />Champion</span>
              <span className="font-display text-[16px] font-semibold leading-tight">{gauntletChampion.name}</span>
              <PlayerAvatar name={gauntletChampion.name} imageUrl={null} size="sm" />
            </div>
            {gauntletChampionStats && (
              <div className="font-mono text-[12px] text-[var(--color-text-secondary)] flex items-center gap-5">
                <Stat v={gauntletChampionStats.kd_ratio.toFixed(2)} l="K/D" />
                <Stat v={gauntletChampionStats.overall_adr.toFixed(1)} l="ADR" />
              </div>
            )}
          </div>
        ) : (
          <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">No gauntlet data</div>
        )}
      </div>
    </Link>
  );
}

function Stat({ v, l }: { v: string; l: string }) {
  return (
    <div className="text-right">
      <div className="font-mono text-[14px] font-semibold text-[var(--color-text-primary)] tnum">
        {v}
      </div>
      <div className="tracked text-[9px] text-[var(--color-text-secondary)]">
        {l}
      </div>
    </div>
  );
}

function seasonNumber(s: Season): number {
  return extractSeasonNumber(s.name) ?? 0;
}

export default async function Home() {
  const [seasons, leaderboards, gauntletSummaries, gauntletStats] = await Promise.all([
    getSeasons(),
    getAllLeaderboards(),
    getAllGauntletSummaries(),
    getGauntletStats(),
  ]);

  const upcoming = seasons
    .filter((s) => s.status === 'UPCOMING')
    .sort((a, b) => a.id - b.id);
  const active = seasons.filter((s) => s.status === 'ACTIVE');

  // Group archived seasons by season number; each entry has at most one regular + one gauntlet
  type PastGroup = { num: number; regular: Season | null; gauntlet: Season | null };
  const pastGroupMap = new Map<number, PastGroup>();
  for (const s of seasons.filter((s) => s.status === 'ARCHIVED')) {
    const num = seasonNumber(s);
    const g = pastGroupMap.get(num) ?? { num, regular: null, gauntlet: null };
    if (s.is_gauntlet) g.gauntlet = s; else g.regular = s;
    pastGroupMap.set(num, g);
  }
  const pastGroups = Array.from(pastGroupMap.values()).sort((a, b) => b.num - a.num);

  return (
    <div className="min-h-screen">
      <HomeTopbar />
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        {upcoming.length > 0 && (
          <>
            <SectionLabel>Upcoming Seasons</SectionLabel>
            <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
              {upcoming.map((s) => (
                <UpcomingSeasonRow
                  key={s.id}
                  season={s}
                  leaderboard={leaderboards.get(s.id) ?? []}
                />
              ))}
            </div>
          </>
        )}

        {active.length > 0 && (
          <>
            <SectionLabel>Active Season</SectionLabel>
            {active.map((s) => (
              <ActiveSeasonPanel
                key={s.id}
                season={s}
                leaderboard={leaderboards.get(s.id) ?? []}
              />
            ))}
          </>
        )}

        <SectionLabel>Past Seasons</SectionLabel>
        {pastGroups.length === 0 ? (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
            No completed seasons yet.
          </div>
        ) : (
          <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
            {pastGroups.map(({ num, regular, gauntlet }) =>
              regular && gauntlet ? (
                <CombinedPastSeasonRow
                  key={num}
                  regularSeason={regular}
                  leaderboard={leaderboards.get(regular.id) ?? []}
                  gauntletSummary={gauntletSummaries.get(gauntlet.id)}
                  gauntletLeaderboard={gauntletStats.bySeason[gauntlet.id] ?? []}
                />
              ) : regular ? (
                <PastSeasonRow
                  key={regular.id}
                  season={regular}
                  leaderboard={leaderboards.get(regular.id) ?? []}
                />
              ) : gauntlet ? (
                <GauntletPastSeasonRow
                  key={gauntlet.id}
                  season={gauntlet}
                  summary={gauntletSummaries.get(gauntlet.id)}
                />
              ) : null
            )}
          </div>
        )}
      </main>
    </div>
  );
}
