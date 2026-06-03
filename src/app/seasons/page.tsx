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
    <span>
      <span className="text-[var(--color-text-primary)] font-semibold">{v}</span>
      <span className="ml-1">{l}</span>
    </span>
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
        className="block px-6 py-5 border-b border-[var(--color-border-tertiary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 tracked text-[10px] font-semibold text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] border border-[var(--color-accent-green-border)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-green-fill)] animate-pulse" />
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
              className="block px-5 py-4 border-r border-[var(--color-border-tertiary)] last:border-r-0 hover:bg-[var(--color-bg-secondary)] transition-colors"
            >
              <div className="flex items-center gap-3 mb-2">
                <PlayerAvatar name={p.player_name} imageUrl={null} size="sm" />
                <div className="tracked text-[9px] text-[var(--color-text-secondary)]">
                  {i === 0 ? 'Leader' : i === 1 ? '2nd' : '3rd'}
                </div>
              </div>
              <div className="font-display text-[16px] font-semibold leading-tight truncate">{p.player_name}</div>
              <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mt-1.5 flex items-center gap-3">
                <Stat v={p.overall_adr.toFixed(2)} l="ADR" />
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

function UpcomingSeasonRow({ season }: { season: Season }) {
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
  gauntletSummary,
}: {
  season: Season;
  leaderboard: LeaderboardRowWithId[];
  gauntletSummary?: GauntletSummary;
}) {
  const regWinner = podiumSort(leaderboard)[0] ?? null;
  const gauntletChamp = gauntletSummary?.champion ?? null;

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
          {leaderboard.length} players{gauntletSummary ? ` · Gauntlet: ${gauntletSummary.roundCount} rounds` : ''}
        </div>
      </div>
      <div className="flex items-center gap-8">
        {regWinner && (
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              <span className="tracked text-[9px] text-[var(--color-text-secondary)]">
                {gauntletChamp ? 'Reg. Winner' : 'Champion'}
              </span>
              <span className="font-display text-[16px] font-semibold leading-tight">{regWinner.player_name}</span>
              <PlayerAvatar name={regWinner.player_name} imageUrl={null} size="sm" />
            </div>
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)] flex items-center gap-4">
              <Stat v={`${regWinner.win_rate_percentage.toFixed(1)}%`} l="WR" />
              <Stat v={regWinner.overall_adr.toFixed(2)} l="ADR" />
            </div>
          </div>
        )}
        {gauntletChamp && (
          <div className="flex flex-col items-end gap-1.5 hidden sm:flex">
            <div className="flex items-center gap-2">
              <span className="tracked text-[9px] text-[var(--color-text-secondary)]">Gauntlet</span>
              <span className="font-display text-[16px] font-semibold leading-tight">{gauntletChamp.name}</span>
              <PlayerAvatar name={gauntletChamp.name} imageUrl={null} size="sm" />
            </div>
          </div>
        )}
        {!regWinner && (
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

  const regularSeasons = seasons.filter((s) => !s.is_gauntlet);
  const gauntletSeasons = seasons.filter((s) => s.is_gauntlet);

  // Pair gauntlets to regular seasons by season number
  const gauntletByNum = new Map(
    gauntletSeasons.map((g) => [extractSeasonNumber(g.name), g]),
  );

  const active = regularSeasons.filter((s) => s.status === 'ACTIVE');
  const upcoming = regularSeasons.filter((s) => s.status === 'UPCOMING');
  const past = regularSeasons.filter((s) => s.status === 'COMPLETED' || s.status === 'ARCHIVED');

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
                <UpcomingSeasonRow key={s.id} season={s} />
              ))}
            </div>
          </>
        )}

        {past.length > 0 && (
          <>
            <div className="tracked text-[10px] text-[var(--color-text-secondary)] mb-3">Past</div>
            <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
              {past.map((s) => {
                const num = extractSeasonNumber(s.name);
                const linkedGauntlet = num != null ? gauntletByNum.get(num) : undefined;
                const summary = linkedGauntlet ? gauntletSummaries.get(linkedGauntlet.id) : undefined;
                return (
                  <PastSeasonRow
                    key={s.id}
                    season={s}
                    leaderboard={allLeaderboards.get(s.id) ?? []}
                    gauntletSummary={summary}
                  />
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
