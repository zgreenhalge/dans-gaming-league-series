import Link from 'next/link';
import { TopbarShell } from '@/components/TopbarShell';
import PlayerAvatar from '@/components/PlayerAvatar';
import {
  getSeasons,
  getAllLeaderboards,
  getAllGauntletSummaries,
  getGauntletStats,
  type GauntletSummary,
} from '@/lib/queries';
import type { LeaderboardRowWithId, Season } from '@/lib/types';
import { seasonTitle, extractSeasonNumber } from '@/lib/util';

export const revalidate = 60;
export const metadata = { title: 'Seasons' };

function podiumSort(rows: LeaderboardRowWithId[]): LeaderboardRowWithId[] {
  return [...rows].sort(
    (a, b) =>
      b.win_rate_percentage - a.win_rate_percentage ||
      b.rwr_percentage - a.rwr_percentage,
  );
}

function Stat({ v, l }: { v: string; l: string }) {
  return (
    <div className="text-right">
      <div className="font-mono text-[14px] font-semibold text-[var(--color-text-primary)] tnum">{v}</div>
      <div className="tracked text-[9px] text-[var(--color-text-secondary)]">{l}</div>
    </div>
  );
}

function ActiveSeasonRow({ season, leaderboard }: { season: Season; leaderboard: LeaderboardRowWithId[] }) {
  const sorted = podiumSort(leaderboard);
  const hasData = sorted.length > 0 && sorted[0].matches_played > 0;
  const top3 = sorted.slice(0, 3);

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <Link
        href={`/seasons/${season.id}`}
        className="lift-row block px-6 py-5 border-b border-[var(--color-border-tertiary)]"
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 tracked text-[10px] font-semibold text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] border border-[var(--color-accent-green-border)]">
            <span className="live-dot w-1.5 h-1.5 rounded-full bg-[var(--color-accent-green-fill)]" />
            Live
          </span>
        </div>
        <div className="font-display text-[28px] font-semibold leading-tight">
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
              className="lift-row block px-5 py-4 border-r border-[var(--color-border-tertiary)] last:border-r-0"
            >
              <div className="flex items-center gap-3 mb-2">
                <PlayerAvatar name={p.player_name} imageUrl={null} size="sm" />
                <div className="tracked text-[9px] text-[var(--color-text-secondary)]">
                  {i === 0 ? 'Leader' : i === 1 ? '2nd' : '3rd'}
                </div>
              </div>
              <div className="font-display text-[16px] font-semibold leading-tight truncate">{p.player_name}</div>
              <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-1.5 flex items-center gap-3">
                <span><span className="text-[var(--color-text-primary)] font-semibold">{p.overall_adr.toFixed(2)}</span> ADR</span>
                <span>{p.win_rate_percentage.toFixed(1)}% WR</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="px-6 py-5 font-mono text-[12px] text-[var(--color-text-secondary)]">No matches played yet.</div>
      )}
    </div>
  );
}

function UpcomingSeasonRow({ season, leaderboard }: { season: Season; leaderboard: LeaderboardRowWithId[] }) {
  const meta = [
    leaderboard.length > 0 && `${leaderboard.length} players`,
    season.start_date &&
      new Date(season.start_date + 'T00:00:00Z').toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
      }),
  ].filter(Boolean).join(' · ');

  return (
    <Link
      href={`/seasons/${season.id}`}
      className="lift-row flex items-center justify-between gap-6 px-5 py-4 border-b border-[var(--color-border-tertiary)] last:border-b-0"
    >
      <div className="min-w-0">
        <div className="tracked text-[9px] mb-0.5" style={{ color: 'var(--color-site-accent)' }}>
          Upcoming
        </div>
        <div className="font-display text-[18px] font-semibold leading-tight truncate">
          {seasonTitle(season.name)}
        </div>
        {meta && (
          <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-1">{meta}</div>
        )}
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
  num,
  regular,
  regularLeaderboard,
  gauntlet,
  gauntletSummary,
  gauntletLeaderboard,
}: {
  num: number;
  regular: Season | null;
  regularLeaderboard: LeaderboardRowWithId[];
  gauntlet: Season | null;
  gauntletSummary: GauntletSummary | undefined;
  gauntletLeaderboard: LeaderboardRowWithId[];
}) {
  const href = `/seasons/${(regular ?? gauntlet)!.id}`;
  const regWinner = regular ? (podiumSort(regularLeaderboard)[0] ?? null) : null;
  const gauntletChamp = gauntletSummary?.champion ?? null;
  const gauntletChampStats = gauntletChamp
    ? (gauntletLeaderboard.find((r) => r.player_id === gauntletChamp.player_id) ?? null)
    : null;

  const subtitle = regular ? `${regularLeaderboard.length} players` : '';

  return (
    <Link
      href={href}
      className="lift-row flex flex-col sm:grid sm:grid-cols-[1fr_auto] sm:items-center gap-3 sm:gap-8 px-5 py-4 border-b border-[var(--color-border-tertiary)] last:border-b-0"
    >
      <div className="min-w-0">
        <div className="font-display text-[18px] font-semibold leading-tight truncate">
          Season {num}
        </div>
        {subtitle && (
          <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-1">{subtitle}</div>
        )}
      </div>
      <div className="flex flex-wrap sm:flex-nowrap items-start sm:items-center gap-4 sm:gap-8">
        {regWinner ? (
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              <span className="tracked text-[9px] text-[var(--color-text-secondary)] text-right leading-tight">
                {gauntletChamp ? <>Regular Season<br />Winner</> : 'Champion'}
              </span>
              <span className="font-display text-[16px] font-semibold leading-tight">{regWinner.player_name}</span>
              <PlayerAvatar name={regWinner.player_name} imageUrl={null} size="sm" />
            </div>
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)] flex items-center gap-5">
              <Stat v={regWinner.kd_ratio.toFixed(2)} l="K/D" />
              <Stat v={regWinner.overall_adr.toFixed(2)} l="ADR" />
            </div>
          </div>
        ) : null}
        {gauntletChamp ? (
          <>
            {regWinner && <div className="hidden sm:block w-px self-stretch bg-[var(--color-border-tertiary)]" />}
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex items-center gap-2">
                <span className="tracked text-[9px] text-[var(--color-text-secondary)] text-right leading-tight">
                  {regWinner ? <>Gauntlet<br />Champion</> : 'Champion'}
                </span>
                <span className="font-display text-[16px] font-semibold leading-tight">{gauntletChamp.name}</span>
                <PlayerAvatar name={gauntletChamp.name} imageUrl={null} size="sm" />
              </div>
              {gauntletChampStats && (
                <div className="font-mono text-[12px] text-[var(--color-text-secondary)] flex items-center gap-5">
                  <Stat v={gauntletChampStats.kd_ratio.toFixed(2)} l="K/D" />
                  <Stat v={gauntletChampStats.overall_adr.toFixed(2)} l="ADR" />
                </div>
              )}
            </div>
          </>
        ) : null}
        {!regWinner && !gauntletChamp && (
          <div className="font-mono text-[11px] text-[var(--color-text-secondary)]">No data</div>
        )}
      </div>
    </Link>
  );
}

export default async function SeasonsPage() {
  const [seasons, allLeaderboards, gauntletSummaries, gauntletStats] = await Promise.all([
    getSeasons(),
    getAllLeaderboards(),
    getAllGauntletSummaries(),
    getGauntletStats(),
  ]);

  const active = seasons.filter((s) => !s.is_gauntlet && s.status === 'ACTIVE');
  const upcoming = seasons.filter((s) => !s.is_gauntlet && s.status === 'UPCOMING');

  // Group all past seasons (regular + gauntlet) by season number
  type PastGroup = { num: number; regular: Season | null; gauntlet: Season | null };
  const pastGroupMap = new Map<number, PastGroup>();
  for (const s of seasons.filter((s) => s.status === 'COMPLETED' || s.status === 'ARCHIVED')) {
    const num = extractSeasonNumber(s.name) ?? s.id;
    const g = pastGroupMap.get(num) ?? { num, regular: null, gauntlet: null };
    if (s.is_gauntlet) g.gauntlet = s; else g.regular = s;
    pastGroupMap.set(num, g);
  }
  const pastGroups = Array.from(pastGroupMap.values()).sort((a, b) => b.num - a.num);

  return (
    <div className="min-h-screen">
      <TopbarShell
        crumbs={[
          { label: 'DGLS', href: '/' },
          { label: 'Seasons' },
        ]}
      />
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <div className="font-display text-[36px] font-semibold leading-tight">Seasons</div>
        </div>

        {active.length > 0 && (
          <>
            <div className="tracked text-[10px] text-[var(--color-text-secondary)] mb-3">Active</div>
            <div className="flex flex-col gap-4 mb-10">
              {active.map((s) => (
                <ActiveSeasonRow
                  key={s.id}
                  season={s}
                  leaderboard={allLeaderboards.get(s.id) ?? []}
                />
              ))}
            </div>
          </>
        )}

        {upcoming.length > 0 && (
          <>
            <div className="tracked text-[10px] text-[var(--color-text-secondary)] mb-3">Upcoming</div>
            <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] mb-10">
              {upcoming.map((s) => (
                <UpcomingSeasonRow
                  key={s.id}
                  season={s}
                  leaderboard={allLeaderboards.get(s.id) ?? []}
                />
              ))}
            </div>
          </>
        )}

        {pastGroups.length > 0 && (
          <>
            <div className="tracked text-[10px] text-[var(--color-text-secondary)] mb-3">Past</div>
            <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
              {pastGroups.map(({ num, regular, gauntlet }) => (
                <PastSeasonRow
                  key={num}
                  num={num}
                  regular={regular}
                  regularLeaderboard={regular ? (allLeaderboards.get(regular.id) ?? []) : []}
                  gauntlet={gauntlet}
                  gauntletSummary={gauntlet ? gauntletSummaries.get(gauntlet.id) : undefined}
                  gauntletLeaderboard={gauntlet ? (gauntletStats.bySeason[gauntlet.id] ?? []) : []}
                />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
