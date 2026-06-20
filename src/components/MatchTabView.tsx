'use client';

import { useState } from 'react';
import Link from 'next/link';
import { tabCls, formatEhogDelta } from '@/lib/util';
import PlayerAvatar from '@/components/PlayerAvatar';
import { PlayerName } from '@/components/PlayerName';
import DemoUploadModal from '@/components/DemoUploadModal';
import ScoutingReport from '@/components/ScoutingReport';
import { Checkbox } from '@/components/SeasonFilter';
import TabBar from '@/components/TabBar';
import type { MatchStatRow, MatchScoutingData, H2HData, MatchSabremetricsRow } from '@/lib/queries';
import type { SabFields } from '@/lib/types';
import type { RatingProjection } from '@/lib/ehog';

type Faction = 'CT' | 'T' | null;
type Tab = 'leaderboard' | 'impact' | 'utility' | 'scouting';

function factionClass(f: Faction): string {
  if (f === 'CT') return 'faction-ct';
  if (f === 'T') return 'faction-t';
  return '';
}

function splitStat(
  s: SabFields,
  ct: keyof SabFields,
  t: keyof SabFields,
  includeCT: boolean,
  includeT: boolean,
): number {
  let total = 0;
  if (includeCT) total += s[ct] as number;
  if (includeT) total += s[t] as number;
  return total;
}

function Scoreboard({
  players,
  mvpPlayerId,
  faction,
  currentPlayerId,
  ratingDeltas,
  sabMap,
  includeCT,
  includeT,
}: {
  players: MatchStatRow[];
  mvpPlayerId: number | null;
  faction: Faction;
  currentPlayerId: number | null;
  ratingDeltas: Record<number, number>;
  sabMap?: Map<number, SabFields>;
  includeCT: boolean;
  includeT: boolean;
}) {
  const cls = factionClass(faction);
  const hasSab = sabMap && sabMap.size > 0;
  const bothSides = includeCT && includeT;
  const thStatCls = 'tracked text-[10px] font-semibold text-[var(--color-text-secondary)] text-right px-3 py-2.5 border-b border-[var(--color-border-primary)]';

  return (
    <div className={`border border-[var(--color-border-primary)] overflow-x-auto faction-tint ${cls}`}>
      <table className="w-full min-w-max border-collapse text-[13px]">
        <thead>
          <tr className="bg-[var(--color-bg-secondary)]">
            <th className="sticky-col tracked text-[10px] font-semibold text-[var(--color-text-secondary)] text-left pl-4 pr-3 py-2.5 border-b border-[var(--color-border-primary)] w-[40%]">
              Player
            </th>
            <th className={`${thStatCls}`} title="Kills">K</th>
            <th className={`${thStatCls}`} title="Assists">A</th>
            <th className={`${thStatCls}`} title="Deaths">D</th>
            <th className={`${thStatCls}`} title="Total damage dealt">DMG</th>
            <th className={`${thStatCls}`} title="Average damage per round">ADR</th>
            {hasSab && (
              <>
                <th className={`${thStatCls}`} title="Headshot kill percentage">HS%</th>
                <th className={`${thStatCls}`} title="Enemy players blinded by flashbangs">EF</th>
                <th className={`${thStatCls}`} title="Damage dealt with grenades (HE, molotov, incendiary)">UD</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {players.map((p) => {
            const playedRow = p.rounds_played > 0;
            const sab = sabMap?.get(p.player_id);
            const dash = (v: string) =>
              playedRow ? v : <span className="text-[var(--color-text-secondary)]">—</span>;

            const k = sab && !bothSides ? splitStat(sab, 'kills_ct', 'kills_t', includeCT, includeT) : p.kills;
            const a = sab && !bothSides ? splitStat(sab, 'assists_ct', 'assists_t', includeCT, includeT) : p.assists;
            const d = sab && !bothSides ? splitStat(sab, 'deaths_ct', 'deaths_t', includeCT, includeT) : p.deaths;
            const dmg = sab && !bothSides ? splitStat(sab, 'damage_ct', 'damage_t', includeCT, includeT) : p.damage;
            const adr = p.rounds_played > 0 ? Math.round(dmg / p.rounds_played) : 0;

            let hsPct = '—';
            let ef = 0;
            let ud = 0;
            if (sab) {
              const hs = splitStat(sab, 'headshot_kills_ct', 'headshot_kills_t', includeCT, includeT);
              hsPct = k > 0 ? `${Math.round((hs / k) * 100)}%` : '—';
              ef = sab.enemies_flashed;
              ud = sab.utility_damage;
            }

            return (
              <tr
                key={p.player_id}
                className="lift-row faction-tint-row border-b border-[var(--color-border-tertiary)] last:border-b-0 cursor-pointer"
              >
                <td className="sticky-col pl-3 pr-3 py-2 font-display font-semibold faction-fg">
                  <Link href={`/players/${p.player_id}`} className="flex items-center gap-2.5">
                    <PlayerAvatar name={p.player_name} imageUrl={p.steam_avatar_url} size="sm" />
                    <PlayerName name={p.player_name} isMe={currentPlayerId !== null && p.player_id === currentPlayerId} />
                    {p.player_id === mvpPlayerId && (
                      <span
                        className="ml-0.5 inline-flex items-center px-1.5 py-0.5 tracked text-[9px] font-semibold border"
                        style={{
                          color: 'var(--color-accent-amber-pickborder)',
                          background: 'color-mix(in srgb, var(--color-accent-amber-pickborder) 12%, transparent)',
                          borderColor: 'var(--color-accent-amber-pickborder)',
                        }}
                      >
                        MVP
                      </span>
                    )}
                    {ratingDeltas[p.player_id] != null && (
                      <span className={`ml-1 font-mono text-[10px] ${ratingDeltas[p.player_id] > 0 ? 'text-[var(--color-accent-green-fill)]' : ratingDeltas[p.player_id] < 0 ? 'text-[var(--color-accent-red-fg)]' : 'text-[var(--color-text-secondary)]'}`}>
                        ({formatEhogDelta(ratingDeltas[p.player_id])})
                      </span>
                    )}
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-right font-mono tnum">{dash(String(k))}</td>
                <td className="px-3 py-2.5 text-right font-mono tnum">{dash(String(a))}</td>
                <td className="px-3 py-2.5 text-right font-mono tnum">{dash(String(d))}</td>
                <td className="px-3 py-2.5 text-right font-mono tnum">{dash(dmg.toLocaleString())}</td>
                <td className={`px-3 py-2.5 text-right font-mono tnum ${hasSab ? '' : 'pr-4'} font-semibold`}>
                  {dash(String(adr))}
                </td>
                {hasSab && (
                  <>
                    <td className="px-3 py-2.5 text-right font-mono tnum">{dash(hsPct)}</td>
                    <td className="px-3 py-2.5 text-right font-mono tnum">{dash(String(ef))}</td>
                    <td className="px-3 pr-4 py-2.5 text-right font-mono tnum">{dash(String(ud))}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface SabStatCol {
  header: string;
  title: string;
  render: (s: SabFields, roundsPlayed: number) => React.ReactNode;
}

const tdStatCls = 'px-3 py-2.5 text-right font-mono tnum';

function pctStr(num: number, den: number): string {
  if (den === 0) return '—';
  return `${Math.round((num / den) * 100)}%`;
}

function SabStatTable({
  players,
  faction,
  sabMap,
  cols,
}: {
  players: MatchStatRow[];
  faction: Faction;
  sabMap: Map<number, SabFields>;
  cols: SabStatCol[];
}) {
  const cls = factionClass(faction);
  const thCls = 'tracked text-[10px] font-semibold text-[var(--color-text-secondary)] text-right px-3 py-2.5 border-b border-[var(--color-border-primary)]';

  return (
    <div className={`border border-[var(--color-border-primary)] overflow-x-auto faction-tint ${cls}`}>
      <table className="w-full min-w-max border-collapse text-[13px]">
        <thead>
          <tr className="bg-[var(--color-bg-secondary)]">
            <th className="sticky-col tracked text-[10px] font-semibold text-[var(--color-text-secondary)] text-left pl-4 pr-3 py-2.5 border-b border-[var(--color-border-primary)]">
              Player
            </th>
            {cols.map((c, i) => (
              <th key={i} className={thCls} title={c.title}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {players.map((p) => {
            const sab = sabMap.get(p.player_id);
            return (
              <tr
                key={p.player_id}
                className="lift-row faction-tint-row border-b border-[var(--color-border-tertiary)] last:border-b-0"
              >
                <td className="sticky-col pl-4 pr-3 py-2.5 font-display font-semibold faction-fg">
                  {p.player_name}
                </td>
                {cols.map((c, i) => (
                  <td key={i} className={i === cols.length - 1 ? `${tdStatCls} pr-4 font-semibold` : tdStatCls}>
                    {sab ? c.render(sab, p.rounds_played) : '—'}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const IMPACT_COLS: SabStatCol[] = [
  {
    header: 'Opening Duels',
    title: 'First kill and first death of each round (wins-losses)',
    render: (s) => (
      <span>
        <span className="text-[var(--color-accent-green-fg)]">{s.opening_kills}</span>
        <span className="text-[var(--color-text-secondary)]">-</span>
        <span className="text-[var(--color-accent-red-fg)]">{s.opening_deaths}</span>
      </span>
    ),
  },
  { header: 'Opening %', title: 'Percentage of rounds where this player took the opening duel', render: (s, rp) => pctStr(s.opening_kills + s.opening_deaths, rp) },
  { header: 'KAST', title: 'Percentage of rounds with a Kill, Assist, Survived, or Traded', render: (s, rp) => pctStr(s.kast_rounds, rp) },
  { header: '2K', title: 'Rounds where this player eliminated both opponents', render: (s) => s.two_k_rounds },
  { header: '1v1', title: '1v1 clutch wins / attempts', render: (s) => `${s.clutch_1v1_wins}/${s.clutch_1v1_attempts}` },
  { header: '1v2', title: '1v2 clutch wins / attempts', render: (s) => `${s.clutch_1v2_wins}/${s.clutch_1v2_attempts}` },
  {
    header: 'Clutch %',
    title: 'Overall clutch success rate (1v1 + 1v2 wins / attempts)',
    render: (s) => {
      const attempts = s.clutch_1v1_attempts + s.clutch_1v2_attempts;
      const wins = s.clutch_1v1_wins + s.clutch_1v2_wins;
      return pctStr(wins, attempts);
    },
  },
];

const UTILITY_COLS: SabStatCol[] = [
  { header: 'Utility Damage', title: 'Damage dealt with grenades (HE, molotov, incendiary)', render: (s) => s.utility_damage },
  { header: 'Flash Assists', title: 'Kills by a teammate on an enemy you flashbanged', render: (s) => s.flash_assists },
  { header: 'Enemies Flashed', title: 'Enemy players blinded by your flashbangs', render: (s) => s.enemies_flashed },
  { header: 'Blind Duration', title: 'Total seconds of flashbang blindness dealt to enemies', render: (s) => `${s.blind_duration_dealt.toFixed(1)}s` },
  { header: 'Flashes Thrown', title: 'Total flashbangs thrown', render: (s) => s.flashes_thrown },
  { header: 'Teamflash', title: 'Total seconds of flashbang blindness dealt to teammates', render: (s) => `${s.teamflash_duration.toFixed(1)}s` },
  { header: 'Plants', title: 'Bomb plants', render: (s) => s.plants },
  { header: 'Defuses', title: 'Bomb defuses', render: (s) => s.defuses },
];

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
        <span className="font-display text-[20px] font-bold faction-fg">{name}</span>
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

function deltaColor(delta: number, maxAbs: number): string {
  if (maxAbs === 0) return 'rgba(255,255,255,0.5)';
  const t = Math.min(1, Math.abs(delta) / maxAbs);
  if (delta > 0) return `color-mix(in srgb, var(--color-accent-green-fill) ${Math.round(t * 100)}%, rgba(255,255,255,0.5))`;
  if (delta < 0) return `color-mix(in srgb, var(--color-accent-red-fg) ${Math.round(t * 100)}%, rgba(255,255,255,0.5))`;
  return 'rgba(255,255,255,0.5)';
}

export function RatingProjectionTable({
  projections,
  shirts,
  skins,
}: {
  projections: RatingProjection[];
  shirts: { player_id: number; player_name: string }[];
  skins: { player_id: number; player_name: string }[];
}) {
  const allPlayers = [...shirts, ...skins];
  const maxAbsDelta = Math.max(...projections.flatMap((p) => Object.values(p.deltas).map(Math.abs)), 0.01);
  return (
    <div className="mt-8">
      <div className="flex items-baseline justify-between mb-3">
        <span className="tracked text-[10px] text-[var(--color-text-secondary)]">EHOG rating projections</span>
        <span className="font-mono text-[10px] text-[var(--color-text-secondary)]">based on current ratings</span>
      </div>
      <div className="border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] overflow-x-auto">
        <table className="w-full min-w-max text-[13px]">
          <thead>
            <tr className="bg-[var(--color-bg-secondary)]">
              <th className="sticky-col tracked text-[9px] font-semibold py-2 pl-4 pr-3 border-b border-[var(--color-border-primary)] text-left text-[var(--color-text-secondary)]">
                Score
              </th>
              {allPlayers.map((p) => (
                <th key={p.player_id} className="tracked text-[9px] font-semibold py-2 px-3 border-b border-[var(--color-border-primary)] text-right text-[var(--color-text-secondary)]">
                  {p.player_name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {projections.map((proj) => {
              const shirtsWin = proj.scoreA > proj.scoreB;
              return (
                <tr key={proj.label} className="lift-row bg-[var(--color-bg-primary)] border-b border-[var(--color-border-tertiary)] last:border-b-0">
                  <td className="sticky-col pl-4 pr-3 py-2.5 font-mono tnum text-[var(--color-text-secondary)] whitespace-nowrap">
                    <span className={shirtsWin ? 'text-[var(--color-accent-green-fg)]' : 'text-[var(--color-accent-red-fg)]'}>
                      {proj.label}
                    </span>
                  </td>
                  {allPlayers.map((p) => {
                    const delta = proj.deltas[p.player_id] ?? 0;
                    return (
                      <td
                        key={p.player_id}
                        className="px-3 py-2.5 text-right font-mono tnum font-semibold"
                        style={{ color: deltaColor(delta, maxAbsDelta) }}
                      >
                        {delta > 0 ? '+' : ''}{delta.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function MatchTabView({
  shirts,
  skins,
  score,
  shirtsWon,
  shirtsF,
  skinsF,
  mvpPlayerId,
  currentPlayerId,
  played,
  canEnterResults,
  isCurrentUserAdmin,
  matchId,
  matchPlayers,
  targetWinRounds,
  skinsSide,
  scoutingData,
  scoutingH2H,
  matchMap,
  mapPool,
  demoDownloadUrl,
  ratingDeltas,
  ratingProjections = [],
  sabremetrics = [],
}: {
  shirts: MatchStatRow[];
  skins: MatchStatRow[];
  score: { shirts: number; skins: number } | null;
  shirtsWon: boolean;
  shirtsF: Faction;
  skinsF: Faction;
  mvpPlayerId: number | null;
  currentPlayerId: number | null;
  played: boolean;
  canEnterResults: boolean;
  isCurrentUserAdmin: boolean;
  matchId: number;
  matchPlayers: { player_id: number; player_name: string; faction: 'SHIRTS' | 'SKINS' }[];
  targetWinRounds: number;
  skinsSide: 'CT' | 'T' | null;
  scoutingData: MatchScoutingData | null;
  scoutingH2H: H2HData | null;
  matchMap: string | null;
  mapPool: string[] | null;
  demoDownloadUrl: string | null;
  ratingDeltas: Record<number, number>;
  ratingProjections?: RatingProjection[];
  sabremetrics?: MatchSabremetricsRow[];
}) {
  const hasScoutingData = !!(scoutingData && scoutingH2H);
  const hasProjections = ratingProjections.length > 0;
  const hasSab = sabremetrics.length > 0;
  const [tab, setTab] = useState<Tab>('leaderboard');
  const [includeCT, setIncludeCT] = useState(true);
  const [includeT, setIncludeT] = useState(true);

  const allStats = [...shirts, ...skins];
  const statsRecorded = allStats.length > 0;

  const sabMap = new Map<number, SabFields>(
    sabremetrics.map((s) => [s.player_id, s]),
  );

  return (
    <>
      <TabBar
        className="mt-10 mb-2"
        controls={
          tab === 'leaderboard' ? (
            <>
              {hasSab && (
                <>
                  <Checkbox checked={includeCT} onToggle={() => setIncludeCT((v) => !v)} label="CT" />
                  <Checkbox checked={includeT} onToggle={() => setIncludeT((v) => !v)} label="T" />
                </>
              )}
              <div className="flex items-center gap-2">
                {demoDownloadUrl && (
                  <a
                    href={demoDownloadUrl}
                    download
                    className="py-1 text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:underline underline-offset-2 transition-colors"
                  >
                    Download demo
                  </a>
                )}
                {canEnterResults && (
                  <DemoUploadModal
                    matchId={matchId}
                    players={matchPlayers}
                    skinsSide={skinsSide}
                    targetWinRounds={targetWinRounds}
                    isAdmin={isCurrentUserAdmin}
                    alreadyPlayed={played}
                    hasDemoUploaded={!!demoDownloadUrl}
                    initialStats={allStats.length > 0 ? allStats : undefined}
                    initialShirtsScore={score?.shirts ?? null}
                    initialSkinsScore={score?.skins ?? null}
                  />
                )}
              </div>
            </>
          ) : undefined
        }
      >
        <button type="button" className={tabCls(tab === 'leaderboard')} onClick={() => setTab('leaderboard')}>
          Scoreboard
        </button>
        {hasSab && (
          <>
            <button type="button" className={tabCls(tab === 'impact')} onClick={() => setTab('impact')}>
              Impact
            </button>
            <button type="button" className={tabCls(tab === 'utility')} onClick={() => setTab('utility')}>
              Utility
            </button>
          </>
        )}
        {(hasScoutingData || hasProjections) && (
          <button type="button" className={tabCls(tab === 'scouting')} onClick={() => setTab('scouting')}>
            Scouting Report
          </button>
        )}
      </TabBar>

      {tab === 'leaderboard' && (
        <>
          {!statsRecorded ? (
            <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-4">
              This match hasn&apos;t been recorded yet.
            </div>
          ) : (
            <>
              <div>
                <TeamHeader
                  name="Shirts"
                  faction={shirtsF}
                  score={score?.shirts ?? null}
                  outcome={score ? (shirtsWon ? 'WON' : 'LOST') : null}
                />
                <Scoreboard players={shirts} mvpPlayerId={mvpPlayerId} faction={shirtsF} currentPlayerId={currentPlayerId} ratingDeltas={ratingDeltas} sabMap={hasSab ? sabMap : undefined} includeCT={includeCT} includeT={includeT} />
              </div>
              <div className="mt-6">
                <TeamHeader
                  name="Skins"
                  faction={skinsF}
                  score={score?.skins ?? null}
                  outcome={score ? (!shirtsWon ? 'WON' : 'LOST') : null}
                />
                <Scoreboard players={skins} mvpPlayerId={mvpPlayerId} faction={skinsF} currentPlayerId={currentPlayerId} ratingDeltas={ratingDeltas} sabMap={hasSab ? sabMap : undefined} includeCT={includeCT} includeT={includeT} />
              </div>
            </>
          )}
        </>
      )}

      {(tab === 'impact' || tab === 'utility') && statsRecorded && (
        <>
          <div>
            <TeamHeader
              name="Shirts"
              faction={shirtsF}
              score={score?.shirts ?? null}
              outcome={score ? (shirtsWon ? 'WON' : 'LOST') : null}
            />
            <SabStatTable players={shirts} faction={shirtsF} sabMap={sabMap} cols={tab === 'impact' ? IMPACT_COLS : UTILITY_COLS} />
          </div>
          <div className="mt-6">
            <TeamHeader
              name="Skins"
              faction={skinsF}
              score={score?.skins ?? null}
              outcome={score ? (!shirtsWon ? 'WON' : 'LOST') : null}
            />
            <SabStatTable players={skins} faction={skinsF} sabMap={sabMap} cols={tab === 'impact' ? IMPACT_COLS : UTILITY_COLS} />
          </div>
        </>
      )}

      {tab === 'scouting' && (
        <>
          {hasProjections && (
            <RatingProjectionTable
              projections={ratingProjections}
              shirts={matchPlayers.filter((p) => p.faction === 'SHIRTS')}
              skins={matchPlayers.filter((p) => p.faction === 'SKINS')}
            />
          )}
          {hasScoutingData && (
            <ScoutingReport
              shirts={[scoutingData!.shirts[0], scoutingData!.shirts[1]]}
              skins={[scoutingData!.skins[0], scoutingData!.skins[1]]}
              duos={scoutingH2H!.duos}
              rivals={scoutingH2H!.rivals}
              matchMap={matchMap}
              mapPool={mapPool}
              mapLeagueAverages={scoutingData!.mapLeagueAverages}
              shirtsF={shirtsF}
              skinsF={skinsF}
            />
          )}
        </>
      )}
    </>
  );
}
