import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TopbarShell } from '@/components/TopbarShell';
import {
  getSeason,
  getSeasonLeaderboard,
  getSeasonSchedule,
  getGauntletRounds,
  getGauntletSeasonLeaderboard,
  type WeekWithMatches,
  type MatchWithRoster,
  type GauntletRound,
  type GauntletMatch,
  type GauntletPlayerStat,
} from '@/lib/queries';
import LeaderboardTable from '@/components/LeaderboardTable';
import GauntletStandings from '@/components/GauntletStandings';
import type { Season, LeaderboardRowWithId } from '@/lib/types';
import { isPlayedScore, parseScore } from '@/lib/util';
import { mapImageFor } from '@/lib/maps';

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const season = await getSeason(Number(id));
  return { title: season?.name ?? 'Season' };
}

function countMatches(schedule: WeekWithMatches[]) {
  return schedule.reduce((sum, w) => sum + w.matches.length, 0);
}

function Topbar({ season }: { season: Season }) {
  const isActive = season.status === 'ACTIVE';
  return (
    <TopbarShell
      crumbs={[
        { label: 'DGLS', href: '/' },
        { label: season.name },
      ]}
      nav={
        isActive ? (
          <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 tracked text-[10px] font-semibold text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] border border-[var(--color-accent-green-border)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-green-fill)] animate-pulse" />
            Live
          </span>
        ) : undefined
      }
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

// ─── Regular season components ────────────────────────────────────────────────

function MatchRow({ match }: { match: MatchWithRoster }) {
  const played = isPlayedScore(match.final_score);
  const map = match.shirts_pick ?? match.picked_map;
  const mapImg = mapImageFor(map);
  const shirtsLabel =
    match.shirts.map((p) => p.player_name).join(' & ') || 'Shirts TBD';
  const skinsLabel =
    match.skins.map((p) => p.player_name).join(' & ') || 'Skins TBD';

  return (
    <Link
      href={`/matches/${match.id}`}
      className={`block border-b border-[var(--color-border-tertiary)] last:border-b-0 transition-colors ${mapImg ? 'map-card-bg' : 'hover:bg-[var(--color-bg-secondary)]'}`}
      style={mapImg ? ({ ['--map-img' as string]: `url("${mapImg}")` } as React.CSSProperties) : undefined}
>
      <div className={mapImg ? 'bg-[var(--overlay-strong)] hover:bg-[var(--overlay-medium)] transition-colors' : ''}>
        <div className="px-4 py-2 flex items-center justify-between gap-4 border-b border-[var(--color-border-tertiary)]">
          <div className="flex items-center gap-2">
            <span className="tracked text-[10px] font-semibold text-[var(--color-text-secondary)] map-head">
              Match #{match.match_number}
            </span>
            {map && (
              <span className="font-display text-[16px] font-semibold text-[var(--color-text-primary)] map-head">
                {map}
              </span>
            )}
          </div>
          {played ? (
            <span className="font-mono text-[13px] font-semibold tnum text-[var(--color-text-primary)]">
              {match.final_score}
            </span>
          ) : (
            <span className="tracked text-[9px] font-semibold text-[var(--color-accent-amber-fg)]">
              Pending
            </span>
          )}
        </div>

        <div className="px-4 py-3">
          <div className="font-mono text-[11px] text-[var(--color-text-secondary)] truncate map-head">
            {shirtsLabel} <span className="opacity-50 map-head">vs</span> {skinsLabel}
          </div>
        </div>
      </div>
    </Link>
  );
}

function WeekBlock({ week }: { week: WeekWithMatches }) {
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] mb-4 last:mb-0">
      <div className="px-4 py-2.5 flex items-center justify-between border-b border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)]">
        <span className="tracked text-[11px] font-semibold text-[var(--color-text-primary)]">
          Week {week.week_number}
        </span>
        {week.bye_player_name && (
          <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">
            <span className="tracked mr-1.5">Bye</span>
            {week.bye_player_name}
          </span>
        )}
      </div>
      {week.matches.map((m) => (
        <MatchRow key={m.id} match={m} />
      ))}
    </div>
  );
}

// ─── Gauntlet components ──────────────────────────────────────────────────────

function computeGauntletRecords(matches: GauntletMatch[]) {
  const records = new Map<number, { player_id: number; name: string; wins: number; losses: number }>();
  for (const m of matches) {
    if (!isPlayedScore(m.final_score)) continue;
    for (const p of [...m.shirts, ...m.skins]) {
      const prev = records.get(p.player_id) ?? { player_id: p.player_id, name: p.player_name, wins: 0, losses: 0 };
      p.is_win ? prev.wins++ : prev.losses++;
      records.set(p.player_id, prev);
    }
  }
  return Array.from(records.values()).sort(
    (a, b) => b.wins - a.wins || a.name.localeCompare(b.name),
  );
}


function TeamStatBlock({ players }: { players: GauntletPlayerStat[] }) {
  return (
    <div className="px-3 py-2">
      <table className="w-full border-collapse">
        <tbody>
          {players.map((p) => (
            <tr key={p.player_id} className="bg-[var(--overlay-medium)]">
              <td className="font-display text-[13px] font-semibold pl-2 pr-3 py-0.5 whitespace-nowrap">
                {p.player_name}
              </td>
              <td className="font-mono text-[11px] tnum text-right pr-3 py-0.5 text-[var(--color-text-primary)]">
                {p.kills}/{p.deaths}
              </td>
              <td className="font-mono text-[11px] tnum text-right pr-2 py-0.5 text-[var(--color-text-secondary)] whitespace-nowrap">
                {p.adr} ADR
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GauntletMatchCard({
  match,
  gameNumber,
}: {
  match: GauntletMatch;
  gameNumber: number;
}) {
  const played = isPlayedScore(match.final_score);
  const hasStats = match.shirts.length > 0 || match.skins.length > 0;
  const mapImg = mapImageFor(match.map);

  return (
    <Link
      href={`/matches/${match.id}`}
      className={`block border-b border-[var(--color-border-tertiary)] last:border-b-0 transition-colors ${mapImg ? 'map-card-bg' : 'hover:bg-[var(--color-bg-secondary)]'}`}
      style={mapImg ? ({ ['--map-img' as string]: `url("${mapImg}")` } as React.CSSProperties) : undefined}
    >
      <div className={mapImg ? 'bg-[var(--overlay-strong)] hover:bg-[var(--overlay-medium)] transition-colors' : ''}>
        <div className="px-4 py-2 flex items-center justify-between gap-4 border-b border-[var(--color-border-tertiary)]">
          <div className="flex items-center gap-2">
            <span className="tracked text-[10px] font-semibold text-[var(--color-text-secondary)]">
              Game {gameNumber}
            </span>
            {match.map && (
              <span className="font-display text-[16px] font-semibold text-[var(--color-text-primary)] map-head">
                {match.map}
              </span>
            )}
          </div>
          {played ? (
            <span className="font-mono text-[13px] font-semibold tnum text-[var(--color-text-primary)]">
              {match.final_score}
            </span>
          ) : (
            <span className="tracked text-[9px] font-semibold text-[var(--color-accent-amber-fg)]">
              Pending
            </span>
          )}
        </div>

        {hasStats && (
          <div className="grid grid-cols-2 divide-x divide-[var(--color-border-tertiary)]">
            <TeamStatBlock players={match.shirts} />
            <TeamStatBlock players={match.skins} />
          </div>
        )}
      </div>
    </Link>
  );
}

function GauntletRoundCard({ round }: { round: GauntletRound }) {
  const records = computeGauntletRecords(round.matches);
  const allPlayed = round.matches.length > 0 && round.matches.every((m) => isPlayedScore(m.final_score));

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] mb-4 last:mb-0">
      <div className="px-4 py-2.5 border-b border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)]">
        <span className="tracked text-[11px] font-semibold text-[var(--color-text-primary)]">
          Round {round.round_number}
        </span>
      </div>

      {round.matches.map((m, i) => (
        <GauntletMatchCard key={m.id} match={m} gameNumber={i + 1} />
      ))}

      {records.length > 0 && (
        <div className="border-t-2 border-[var(--color-border-primary)] px-4 py-3 bg-[var(--color-bg-secondary)]">
          <div className="tracked text-[9px] text-[var(--color-text-secondary)] mb-2">
            Results
          </div>
          <div className="flex flex-col gap-1.5">
            {records.map((r) => {
              const is20 = allPlayed && r.wins === 2;
              const is02 = allPlayed && r.losses === 2;
              return (
                <div key={r.name} className="flex items-center justify-between gap-3">
                  <span className="font-display text-[13px] font-semibold">
                    {r.name}
                  </span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-mono text-[12px] tnum font-semibold ${
                        is20
                          ? 'text-[var(--color-accent-green-fg)]'
                          : is02
                            ? 'text-[var(--color-text-secondary)]'
                            : 'text-[var(--color-text-primary)]'
                      }`}
                    >
                      {r.wins}-{r.losses}
                    </span>
                    {is20 && (
                      <span className="tracked text-[9px] font-semibold px-1.5 py-0.5 border text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] border-[var(--color-accent-green-border)]">
                        Advances
                      </span>
                    )}
                    {is02 && (
                      <span className="tracked text-[9px] font-semibold px-1.5 py-0.5 border text-[var(--color-text-secondary)] bg-[var(--color-bg-secondary)] border-[var(--color-border-primary)]">
                        Eliminated
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SeasonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isFinite(seasonId)) notFound();

  const season = await getSeason(seasonId);
  if (!season) notFound();

  if (season.is_gauntlet) {
    const [rounds, leaderboard] = await Promise.all([
      getGauntletRounds(seasonId),
      getGauntletSeasonLeaderboard(seasonId),
    ]);
    const matchCount = rounds.reduce((sum, r) => sum + r.matches.length, 0);

    return (
      <div className="min-h-screen">
        <Topbar season={season} />
        <main className="max-w-[1080px] mx-auto px-6 pb-16">
          <div className="mt-8 mb-6">
            <div className="font-display text-[36px] font-semibold leading-tight">
              {season.name}
            </div>
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1.5">
              {matchCount} matches · {rounds.length} rounds
            </div>
          </div>

          <GauntletStandings rounds={rounds} leaderboard={leaderboard} />

          <SectionLabel>Stats</SectionLabel>
          {leaderboard.length === 0 ? (
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
              No stats recorded yet.
            </div>
          ) : (
            <LeaderboardTable rows={leaderboard} showMedals={false} />
          )}

          <SectionLabel>Rounds</SectionLabel>
          {rounds.length === 0 ? (
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
              No rounds recorded.
            </div>
          ) : (
            rounds.map((r) => <GauntletRoundCard key={r.round_number} round={r} />)
          )}
        </main>
      </div>
    );
  }

  const [leaderboard, schedule] = await Promise.all([
    getSeasonLeaderboard(seasonId),
    getSeasonSchedule(seasonId),
  ]);
  const matchCount = countMatches(schedule);

  return (
    <div className="min-h-screen">
      <Topbar season={season} />
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <div className="font-display text-[36px] font-semibold leading-tight">
            {season.name}
          </div>
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1.5">
            {leaderboard.length} players · {matchCount} matches · {schedule.length} weeks
          </div>
        </div>

        <SectionLabel>Leaderboard</SectionLabel>
        {leaderboard.length === 0 ? (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
            No leaderboard data yet.
          </div>
        ) : (
          <LeaderboardTable rows={leaderboard} />
        )}

        <SectionLabel>Schedule</SectionLabel>
        {schedule.length === 0 ? (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
            No weeks scheduled.
          </div>
        ) : (
          schedule.map((w) => <WeekBlock key={w.id} week={w} />)
        )}
      </main>
    </div>
  );
}
