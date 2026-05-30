import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
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
} from '@/lib/queries';
import LeaderboardTable from '@/components/LeaderboardTable';
import GauntletStandings from '@/components/GauntletStandings';
import { MatchCard, type MatchCardRight } from '@/components/MatchCard';
import type { Season, LeaderboardRowWithId } from '@/lib/types';
import { isPlayedScore, fmtWindowDate } from '@/lib/util';
import SeasonStartDateButton from '@/components/SeasonStartDateButton';
import { authOptions } from '@/lib/authOptions';
import { supabase } from '@/lib/supabase';
import { YouBadge } from '@/components/YouBadge';

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

// ─── Week window helpers ──────────────────────────────────────────────────────

function weekWindow(
  startDate: string | null,
  weekNumber: number,
): { start: Date; end: Date } | null {
  if (!startDate) return null;
  const [y, m, d] = startDate.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  return {
    start: new Date(base + (weekNumber - 1) * 7 * 86_400_000),
    end: new Date(base + ((weekNumber - 1) * 7 + 6) * 86_400_000),
  };
}

// ─── Regular season components ────────────────────────────────────────────────

function WeekBlock({
  week,
  seasonStartDate,
  currentPlayerId,
}: {
  week: WeekWithMatches;
  seasonStartDate: string | null;
  currentPlayerId: number | null;
}) {
  const win = weekWindow(seasonStartDate, week.week_number);
  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] mb-4 last:mb-0">
      <div className="px-4 py-2.5 flex items-center justify-between gap-3 border-b border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)]">
        <div className="flex items-baseline gap-2.5">
          <span className="tracked text-[11px] font-semibold text-[var(--color-text-primary)]">
            Week {week.week_number}
          </span>
          {win && (
            <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">
              {fmtWindowDate(win.start)} – {fmtWindowDate(win.end)}
            </span>
          )}
        </div>
        {week.bye_player_name && (
          <span className="font-mono text-[10px] text-[var(--color-text-secondary)] inline-flex items-center gap-1">
            <span className="tracked mr-0.5">Bye</span>
            {week.bye_player_name}
            {currentPlayerId !== null && week.bye_player_id === currentPlayerId && <YouBadge />}
          </span>
        )}
      </div>
      {week.matches.map((m) => {
        const played = isPlayedScore(m.final_score);
        let right: MatchCardRight = null;
        if (played) {
          right = { type: 'score', score: m.final_score! };
        } else if (m.scheduled_at) {
          right = { type: 'scheduled', scheduledAt: m.scheduled_at };
        } else if (win) {
          right = { type: 'week-window', weekStart: win.start, weekEnd: win.end };
        }
        return (
          <MatchCard
            key={m.id}
            href={`/matches/${m.id}`}
            map={m.shirts_pick ?? m.picked_map}
            label={{ type: 'match', matchNumber: m.match_number }}
            right={right}
            shirtsStats={m.shirts_stats}
            skinsStats={m.skins_stats}
            shirtsFallback={m.shirts.map((p) => p.player_name).join(' & ') || 'Shirts TBD'}
            skinsFallback={m.skins.map((p) => p.player_name).join(' & ') || 'Skins TBD'}
            currentPlayerId={currentPlayerId}
          />
        );
      })}
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

function GauntletRoundCard({
  round,
  allRounds,
  currentPlayerId,
}: {
  round: GauntletRound;
  allRounds: GauntletRound[];
  currentPlayerId: number | null;
}) {
  const records = computeGauntletRecords(round.matches);
  const allPlayed = round.matches.length > 0 && round.matches.every((m) => isPlayedScore(m.final_score));

  const maxRoundNumber = Math.max(...allRounds.map((r) => r.round_number));
  const isFinalRound = round.round_number === maxRoundNumber;

  // Build the set of players who appear in any subsequent round
  const playerIdsInLaterRounds = new Set<number>();
  for (const r of allRounds) {
    if (r.round_number <= round.round_number) continue;
    for (const m of r.matches) {
      for (const p of [...m.shirts, ...m.skins]) {
        playerIdsInLaterRounds.add(p.player_id);
      }
    }
  }

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] mb-4 last:mb-0">
      <div className="px-4 py-2.5 border-b border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)]">
        <span className="tracked text-[11px] font-semibold text-[var(--color-text-primary)]">
          Round {round.round_number}
        </span>
      </div>

      {round.matches.map((m, i) => {
        const played = isPlayedScore(m.final_score);
        return (
          <MatchCard
            key={m.id}
            href={`/matches/${m.id}`}
            map={m.map}
            label={{ type: 'game', gameNumber: i + 1 }}
            right={played ? { type: 'score', score: m.final_score! } : { type: 'pending' }}
            shirtsStats={m.shirts}
            skinsStats={m.skins}
            shirtsFallback={m.shirts.map((p) => p.player_name).join(' & ') || 'Shirts TBD'}
            skinsFallback={m.skins.map((p) => p.player_name).join(' & ') || 'Skins TBD'}
            currentPlayerId={currentPlayerId}
          />
        );
      })}

      {records.length > 0 && (
        <div className="border-t-2 border-[var(--color-border-primary)] px-4 py-3 bg-[var(--color-bg-secondary)]">
          <div className="tracked text-[9px] text-[var(--color-text-secondary)] mb-2">
            Results
          </div>
          <div className="flex flex-col gap-1.5">
            {records.map((r) => {
              const advanced = !isFinalRound && allPlayed && playerIdsInLaterRounds.has(r.player_id);
              const eliminated = !isFinalRound && allPlayed && !playerIdsInLaterRounds.has(r.player_id);
              const isChampion = isFinalRound && allPlayed && records[0]?.player_id === r.player_id && r.wins > r.losses;
              return (
                <div key={r.player_id} className="flex items-center justify-between gap-3">
                  <span className="font-display text-[13px] font-semibold inline-flex items-center gap-1" style={{
                    color: isChampion
                      ? 'var(--color-accent-amber-strong)'
                      : advanced
                        ? 'var(--color-accent-green-fg)'
                        : eliminated
                          ? 'var(--color-text-secondary)'
                          : 'var(--color-text-primary)',
                  }}>
                    {r.name}
                    {currentPlayerId !== null && r.player_id === currentPlayerId && <YouBadge />}
                  </span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-mono text-[12px] tnum font-semibold ${
                        advanced || isChampion
                          ? 'text-[var(--color-accent-green-fg)]'
                          : eliminated
                            ? 'text-[var(--color-text-secondary)]'
                            : 'text-[var(--color-text-primary)]'
                      }`}
                    >
                      {r.wins}-{r.losses}
                    </span>
                    {advanced && (
                      <span className="tracked text-[9px] font-semibold px-1.5 py-0.5 border text-[var(--color-accent-green-fg)] bg-[var(--color-accent-green-bg)] border-[var(--color-accent-green-border)]">
                        Advanced
                      </span>
                    )}
                    {eliminated && (
                      <span className="tracked text-[9px] font-semibold px-1.5 py-0.5 border text-[var(--color-text-secondary)] bg-[var(--color-bg-secondary)] border-[var(--color-border-primary)]">
                        Eliminated
                      </span>
                    )}
                    {isChampion && (
                      <span className="tracked text-[9px] font-semibold px-1.5 py-0.5 border text-[var(--color-accent-amber-strong)] bg-[var(--color-accent-amber-bg)] border-[var(--color-accent-amber-border)]">
                        Champion
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

  // Admin check — used by both gauntlet and regular season views
  const session = await getServerSession(authOptions);
  const currentPlayerId = session?.user?.playerId ?? null;
  let isAdmin = false;
  if (session?.user?.playerId) {
    const { data: playerRow } = await supabase
      .from('players')
      .select('is_admin')
      .eq('id', session.user.playerId)
      .maybeSingle();
    isAdmin = !!(playerRow as { is_admin?: boolean } | null)?.is_admin;
  }

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
            <div className="mt-2">
              <SeasonStartDateButton
                seasonId={season.id}
                startDate={season.start_date}
                canEdit={isAdmin}
              />
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
            rounds.map((r) => <GauntletRoundCard key={r.round_number} round={r} allRounds={rounds} currentPlayerId={currentPlayerId} />)
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
          <div className="mt-2">
            <SeasonStartDateButton
              seasonId={season.id}
              startDate={season.start_date}
              canEdit={isAdmin}
            />
          </div>
        </div>

        <SectionLabel>Leaderboard</SectionLabel>
        {leaderboard.length === 0 ? (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
            No leaderboard data yet.
          </div>
        ) : (
          <LeaderboardTable rows={leaderboard} showMedals={season.status === 'COMPLETED'} playoffZones={season.status === 'ACTIVE' ? { top: 2, bottom: 4 } : undefined} />
        )}

        <SectionLabel>Schedule</SectionLabel>
        {schedule.length === 0 ? (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">
            No weeks scheduled.
          </div>
        ) : (
          schedule.map((w) => (
            <WeekBlock key={w.id} week={w} seasonStartDate={season.start_date} currentPlayerId={currentPlayerId} />
          ))
        )}
      </main>
    </div>
  );
}
