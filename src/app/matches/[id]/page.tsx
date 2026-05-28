import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { getMatch, type MatchStatRow } from '@/lib/queries';
import type { Match } from '@/lib/types';
import { isPlayedScore, parseScore } from '@/lib/util';
import { mapImageFor } from '@/lib/maps';
import { TopbarShell } from '@/components/TopbarShell';
import PlayerAvatar from '@/components/PlayerAvatar';
import MatchHeaderSection from '@/components/MatchHeaderSection';
import { authOptions } from '@/lib/authOptions';
import { supabase } from '@/lib/supabase';

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

function VetoSequence({ match }: { match: Match }) {
  const side = match.skins_starting_side;
  const sideCls =
    side === 'CT'
      ? 'bg-[var(--color-accent-blue-bg)] border-[var(--color-accent-blue-border)] [&_.lbl]:text-[var(--color-accent-blue-fg)] [&_.val]:text-[var(--color-accent-blue-strong)]'
      : side === 'T'
        ? 'bg-[var(--color-accent-amber-bg)] border-[var(--color-accent-amber-border)] [&_.lbl]:text-[var(--color-accent-amber-fg)] [&_.val]:text-[var(--color-accent-amber-strong)]'
        : 'bg-[var(--color-bg-secondary)] border-[var(--color-border-tertiary)] [&_.lbl]:text-[var(--color-text-secondary)] [&_.val]:text-[var(--color-text-primary)]';

  const banCls =
    'bg-[var(--color-accent-green-bg)] border-[var(--color-accent-green-border)] [&_.lbl]:text-[var(--color-accent-green-fg)] [&_.val]:text-[var(--color-accent-green-strong)]';
  const pickCls =
    'bg-[var(--color-accent-green-bg)] border-2 border-[var(--color-accent-amber-pickborder)] [&_.lbl]:text-[var(--color-accent-green-fg)] [&_.val]:text-[var(--color-accent-green-strong)]';

  const steps: { label: string; val: string | null; cls: string }[] =
    match.is_playoff_game
      ? [
          { label: 'Shirts ban', val: match.shirts_ban, cls: banCls },
          { label: 'Shirts ban', val: match.shirts_ban2, cls: banCls },
          { label: 'Skins ban', val: match.skins_ban1, cls: banCls },
          { label: 'Skins ban', val: match.skins_ban2, cls: banCls },
          { label: 'Map pick', val: match.shirts_pick ?? match.picked_map, cls: pickCls },
          { label: 'Skins side', val: side, cls: sideCls },
        ]
      : [
          { label: 'Shirts ban', val: match.shirts_ban, cls: banCls },
          { label: 'Skins ban', val: match.skins_ban1, cls: banCls },
          { label: 'Skins ban', val: match.skins_ban2, cls: banCls },
          { label: 'Map pick', val: match.shirts_pick ?? match.picked_map, cls: pickCls },
          { label: 'Skins side', val: side, cls: sideCls },
        ];

  return (
    <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]">
      <div className="flex items-stretch gap-1 flex-wrap p-3">
        {steps.map((s, i) => (
          <span key={i} className="flex items-center gap-1 flex-1 min-w-[88px]">
            {i > 0 && (
              <span className="text-[var(--color-text-secondary)] text-sm shrink-0 font-mono">
                ›
              </span>
            )}
            <div className={`flex-1 min-w-[88px] px-2.5 py-2 border ${s.cls}`}>
              <div className="lbl tracked text-[9px] font-semibold mb-0.5">
                {s.label}
              </div>
              <div className="val font-display text-[14px] font-semibold leading-tight">
                {s.val ?? '—'}
              </div>
            </div>
          </span>
        ))}
      </div>
    </div>
  );
}

function Scoreboard({
  players,
  mvpPlayerId,
  faction,
}: {
  players: MatchStatRow[];
  mvpPlayerId: number | null;
  faction: Faction;
}) {
  const cls = factionClass(faction);
  return (
    <div
      className={`border border-[var(--color-border-primary)] overflow-hidden faction-tint ${cls}`}
    >
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-[var(--color-bg-secondary)]">
            <th className="tracked text-[10px] font-semibold text-[var(--color-text-secondary)] text-left pl-4 pr-3 py-2.5 border-b border-[var(--color-border-primary)]">
              Player
            </th>
            {['K', 'A', 'D', 'DMG', 'ADR'].map((h) => (
              <th
                key={h}
                className="tracked text-[10px] font-semibold text-[var(--color-text-secondary)] text-right px-3 py-2.5 border-b border-[var(--color-border-primary)] whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {players.map((p) => {
            const playedRow = p.rounds_played > 0;
            const dash = (v: string) =>
              playedRow ? (
                v
              ) : (
                <span className="text-[var(--color-text-secondary)]">—</span>
              );
            return (
              <tr
                key={p.player_id}
                className="border-b border-[var(--color-border-tertiary)] last:border-b-0 hover:bg-[var(--color-bg-secondary)] cursor-pointer transition-colors"
              >
                <td className="pl-3 pr-3 py-2 font-display font-semibold faction-fg">
                  <Link
                    href={`/players/${p.player_id}`}
                    className="flex items-center gap-2.5"
                  >
                    <PlayerAvatar name={p.player_name} imageUrl={p.steam_avatar_url} size="sm" />
                    {p.player_name}
                    {p.player_id === mvpPlayerId && (
                      <span className="ml-0.5 inline-flex items-center px-1.5 py-0.5 tracked text-[9px] font-semibold border"
                        style={{
                          color: 'var(--color-accent-amber-pickborder)',
                          background: 'color-mix(in srgb, var(--color-accent-amber-pickborder) 12%, transparent)',
                          borderColor: 'var(--color-accent-amber-pickborder)',
                        }}
                      >
                        MVP
                      </span>
                    )}
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-right font-mono tnum">
                  {dash(String(p.kills))}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tnum">
                  {dash(String(p.assists))}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tnum">
                  {dash(String(p.deaths))}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tnum">
                  {dash(p.damage.toLocaleString())}
                </td>
                <td className="px-3 pr-4 py-2.5 text-right font-mono tnum font-semibold">
                  {dash(p.adr.toFixed(1))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TeamHeader({
  name,
  faction,
  score,
  outcome,
}: {
  name: string;
  faction: Faction;
  score: number | null;
  outcome: 'WON' | 'LOST' | null;
}) {
  const cls = factionClass(faction);
  return (
    <div
      className={`${cls} faction-rule pl-4 pr-4 py-3 border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] flex items-baseline justify-between`}
    >
      <div className="flex items-baseline gap-3">
        {score !== null && (
          <span className="font-display font-semibold text-[28px] leading-none tnum text-[var(--color-text-primary)]">
            {score}
          </span>
        )}
        <span className="font-display text-[20px] font-semibold faction-fg">
          {name}
        </span>
      </div>
      {outcome && (
        <span
          className={`tracked text-[10px] font-semibold ${
            outcome === 'WON'
              ? 'text-[var(--color-accent-green-fg)]'
              : 'text-[var(--color-text-secondary)]'
          }`}
        >
          {outcome}
        </span>
      )}
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
  const allByAdr = [...stats]
    .filter((s) => s.rounds_played > 0)
    .sort((a, b) => b.adr - a.adr);
  const mvpPlayerId =
    played && allByAdr.length > 0 ? allByAdr[0].player_id : null;

  const shirtsWon = score ? score.shirts > score.skins : false;
  const shirtsF = shirtsFaction(match.skins_starting_side);
  const skinsF: Faction = match.skins_starting_side;

  // Scheduling: admins only, not available on gauntlet matches
  let canEdit = false;
  if (!played && !season.is_gauntlet) {
    const session = await getServerSession(authOptions);
    const currentPlayerId = session?.user?.playerId ?? null;
    if (currentPlayerId !== null) {
      const { data: playerRow } = await supabase
        .from('players')
        .select('is_admin')
        .eq('id', currentPlayerId)
        .maybeSingle();
      canEdit = !!(playerRow as { is_admin?: boolean } | null)?.is_admin;
    }
  }

  const window = matchWeekWindow(season.start_date, week.week_number);

  return (
    <div className="min-h-screen">
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
                  <span className="font-display text-[24px] font-semibold faction-fg">
                    Shirts
                  </span>
                  <span className="display-numeral text-[64px] text-[var(--color-text-primary)] tnum">
                    {score.shirts}
                  </span>
                </div>
                <span className="font-mono text-[24px] text-[var(--color-text-secondary)]">
                  —
                </span>
                <div className={`${factionClass(skinsF)} flex items-baseline gap-3`}>
                  <span className="display-numeral text-[64px] text-[var(--color-text-primary)] tnum">
                    {score.skins}
                  </span>
                  <span className="font-display text-[24px] font-semibold faction-fg">
                    Skins
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="tracked text-[10px] text-[var(--color-text-secondary)] mb-3">
            Veto sequence
          </div>
          <div className="pb-6">
            <VetoSequence match={match} />
          </div>
        </div>

        {stats.length === 0 ? (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-10">
            This match hasn&apos;t been recorded yet.
          </div>
        ) : (
          <>
            <div className="mt-10">
              <TeamHeader
                name="Shirts"
                faction={shirtsF}
                score={score?.shirts ?? null}
                outcome={score ? (shirtsWon ? 'WON' : 'LOST') : null}
              />
              <Scoreboard
                players={shirts}
                mvpPlayerId={mvpPlayerId}
                faction={shirtsF}
              />
            </div>

            <div className="mt-6">
              <TeamHeader
                name="Skins"
                faction={skinsF}
                score={score?.skins ?? null}
                outcome={score ? (!shirtsWon ? 'WON' : 'LOST') : null}
              />
              <Scoreboard
                players={skins}
                mvpPlayerId={mvpPlayerId}
                faction={skinsF}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
