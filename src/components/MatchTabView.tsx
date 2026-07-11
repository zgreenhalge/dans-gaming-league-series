'use client';

import { useState } from 'react';
import Link from 'next/link';
import { tabCls, formatEhogDelta } from '@/lib/util';
import PlayerAvatar from '@/components/PlayerAvatar';
import { PlayerName } from '@/components/PlayerName';
import DemoUploadModal from '@/components/DemoUploadModal';
import MatchRecapTab from '@/components/MatchRecapTab';
import ScoutingReport from '@/components/ScoutingReport';
import { Checkbox } from '@/components/SeasonFilter';
import TabBar from '@/components/TabBar';
import SabremetricsLeaderboardView, { type SabremetricStatRow, type TeamGroup } from '@/components/SabremetricsLeaderboardView';
import type { MatchStatRow, MatchScoutingData, H2HData, MatchSabremetricsRow, ReplayJobState, ReplayEventsView } from '@/lib/queries';
import type { SabFields } from '@/lib/types';
import type { RatingProjection } from '@/lib/ehog';
import { RecordingViewer, RecordingUrlForm } from '@/components/RecordingViewer';

type Faction = 'CT' | 'T' | null;
type Tab = 'leaderboard' | 'advanced' | 'scouting' | 'recap' | 'recording';

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

function formatWinPct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/**
 * Tooltip copy is static baseline text plus a provisional-players sentence appended only when
 * one of the four players is still early enough in their rating history (PROVISIONAL_SIGMA_THRESHOLD
 * in constants.json) that the prediction carries extra uncertainty beyond the number shown.
 */
function WinProbabilityTooltip({ provisional }: { provisional: boolean }) {
  return (
    <span tabIndex={0} className="group relative inline-flex items-center cursor-help ml-1.5">
      <span className="border border-[var(--color-border-secondary)] rounded-full w-3.5 h-3.5 inline-flex items-center justify-center leading-none font-mono text-[9px] text-[var(--color-text-secondary)]">
        ?
      </span>
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 w-64 rounded border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] p-2 font-mono text-[10px] leading-snug normal-case text-[var(--color-text-secondary)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus:opacity-100 z-10">
        EHOG win probability comes from each team&apos;s current rating alone. A narrow gap in a
        small, wide-skill league can still land near 50%, and a wide gap can land at 80–90% — both
        are expected, not a bug.
        {provisional && (
          <>
            {' '}One or more players here are still early in their rating history, so this
            prediction carries extra uncertainty beyond the number shown.
          </>
        )}
      </span>
    </span>
  );
}

function WinProbabilityBadge({
  winProbability,
  postMatchWinProb,
  shirtsWon,
}: {
  winProbability: { pShirtsWin: number; provisional: boolean } | null;
  postMatchWinProb: number | null;
  shirtsWon: boolean;
}) {
  if (winProbability) {
    const favored = winProbability.pShirtsWin >= 0.5 ? 'SHIRTS' : 'SKINS';
    const pct = formatWinPct(Math.max(winProbability.pShirtsWin, 1 - winProbability.pShirtsWin));
    return (
      <div className="flex items-center font-mono text-[11px] text-[var(--color-text-secondary)] mb-3">
        <span className="tracked">EHOG favors {favored} · {pct}</span>
        <WinProbabilityTooltip provisional={winProbability.provisional} />
      </div>
    );
  }
  if (postMatchWinProb != null) {
    const winner = shirtsWon ? 'SHIRTS' : 'SKINS';
    const expected = formatWinPct(shirtsWon ? postMatchWinProb : 1 - postMatchWinProb);
    return (
      <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mb-3">
        <span className="tracked">{winner} won · expected {expected}</span>
      </div>
    );
  }
  return null;
}

export function RatingProjectionTable({
  projections,
  shirts,
  skins,
  current,
}: {
  projections: RatingProjection[];
  shirts: { player_id: number; player_name: string }[];
  skins: { player_id: number; player_name: string }[];
  /** Each player's current EHOG rating — anchors the projection deltas below it. */
  current?: Record<number, number>;
}) {
  const allPlayers = [...shirts, ...skins];
  const maxAbsDelta = Math.max(...projections.flatMap((p) => Object.values(p.deltas).map(Math.abs)), 0.01);

  const renderProjRow = (proj: RatingProjection) => {
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
            <td key={p.player_id} className="px-3 py-2.5 text-right font-mono tnum font-semibold" style={{ color: deltaColor(delta, maxAbsDelta) }}>
              {delta > 0 ? '+' : ''}{delta.toFixed(2)}
            </td>
          );
        })}
      </tr>
    );
  };
  // The Current rating sits between the winning scenarios (rating ↑) and the losing
  // ones (↓), so the deltas above/below read as moves away from where they are now.
  const splitIdx = projections.findIndex((p) => p.scoreA <= p.scoreB);
  const wins = splitIdx === -1 ? projections : projections.slice(0, splitIdx);
  const losses = splitIdx === -1 ? [] : projections.slice(splitIdx);

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
            {wins.map(renderProjRow)}
            {current && (
              <tr
                style={{
                  background: 'color-mix(in srgb, #ffffff 16%, var(--color-bg-secondary))',
                  boxShadow: 'inset 0 1px 0 0 #fff, inset 0 -1px 0 0 #fff',
                }}
              >
                <td
                  className="sticky-col pl-4 pr-3 py-2.5 tracked text-[9px] font-semibold text-[var(--color-text-primary)] whitespace-nowrap"
                  style={{ boxShadow: 'inset 0 1px 0 0 #fff, inset 0 -1px 0 0 #fff' }}
                >
                  Current
                </td>
                {allPlayers.map((p) => (
                  <td key={p.player_id} className="px-3 py-2.5 text-right font-mono tnum font-semibold text-[var(--color-text-primary)]">
                    {(current[p.player_id] ?? 0).toFixed(2)}
                  </td>
                ))}
              </tr>
            )}
            {losses.map(renderProjRow)}
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
  mapMatchIds = [],
  mapPool,
  demoDownloadUrl,
  ratingDeltas,
  ratingProjections = [],
  ratingCurrent = {},
  winProbability = null,
  postMatchWinProb = null,
  sabremetrics = [],
  replayJob,
  replayEvents = null,
  recordingURL,
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
  mapMatchIds?: number[];
  mapPool: string[] | null;
  demoDownloadUrl: string | null;
  ratingDeltas: Record<number, number>;
  ratingProjections?: RatingProjection[];
  ratingCurrent?: Record<number, number>;
  winProbability?: { pShirtsWin: number; provisional: boolean } | null;
  postMatchWinProb?: number | null;
  sabremetrics?: MatchSabremetricsRow[];
  replayJob: ReplayJobState;
  replayEvents?: ReplayEventsView | null;
  recordingURL: string | null;
}) {
  const hasScoutingData = !!(scoutingData && scoutingH2H);
  const hasProjections = ratingProjections.length > 0;
  const hasSab = sabremetrics.length > 0;
  // Show the Recap tab when a demo exists, OR when a replay payload is already loaded —
  // so a transient R2 error on demoDownloadUrl (or a demo removed while replay.json
  // remains) can't hide an existing replay/heatmap. Manual, demo-less matches have
  // neither, so the tab stays hidden for them.
  const hasRecap = !!demoDownloadUrl || !!replayEvents;
  const [tab, setTab] = useState<Tab>('leaderboard');
  const [includeCT, setIncludeCT] = useState(true);
  const [includeT, setIncludeT] = useState(true);

  const allStats = [...shirts, ...skins];
  const statsRecorded = allStats.length > 0;
  const canDispatchReplay =
    isCurrentUserAdmin ||
    (currentPlayerId !== null && matchPlayers.some((p) => p.player_id === currentPlayerId));
  // Recording is editable by the same people who can enter results: admins and in-match players.
  const canEditRecording = canDispatchReplay;

  const sabMap = new Map<number, SabFields>(
    sabremetrics.map((s) => [s.player_id, s]),
  );

  // Adapts this match's players + sabremetrics into the shape SabremetricsLeaderboardView
  // expects (same component the season/career Advanced Stats view uses), so the two never
  // drift apart on stat definitions.
  const toSabRows = (players: MatchStatRow[]): SabremetricStatRow[] =>
    players
      .filter((p) => sabMap.has(p.player_id))
      .map((p) => ({
        player_id: p.player_id,
        player_name: p.player_name,
        match_id: matchId,
        rounds_played: p.rounds_played,
        sab: sabMap.get(p.player_id)!,
      }));
  const advancedStatRows = [...toSabRows(shirts), ...toSabRows(skins)];
  const advancedStatTeams: TeamGroup[] = [
    {
      key: 'shirts',
      side: shirtsF,
      playerIds: new Set(shirts.map((p) => p.player_id)),
      header: (
        <TeamHeader
          name="Shirts"
          faction={shirtsF}
          score={score?.shirts ?? null}
          outcome={score ? (shirtsWon ? 'WON' : 'LOST') : null}
        />
      ),
    },
    {
      key: 'skins',
      side: skinsF,
      playerIds: new Set(skins.map((p) => p.player_id)),
      header: (
        <TeamHeader
          name="Skins"
          faction={skinsF}
          score={score?.skins ?? null}
          outcome={score ? (!shirtsWon ? 'WON' : 'LOST') : null}
        />
      ),
    },
  ];

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
          <button type="button" className={tabCls(tab === 'advanced')} onClick={() => setTab('advanced')}>
            Advanced Stats
          </button>
        )}

        {hasScoutingData && (
          <button type="button" className={tabCls(tab === 'scouting')} onClick={() => setTab('scouting')}>
            Scouting Report
          </button>
        )}

        {played && hasRecap && (
          <button type="button" className={tabCls(tab === 'recap')} onClick={() => setTab('recap')}>
            Recap
          </button>
        )}

        {played && (recordingURL || canEditRecording) && (
          <button type="button" className={tabCls(tab === 'recording')} onClick={() => setTab('recording')}>
            Recording
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
              <WinProbabilityBadge winProbability={null} postMatchWinProb={postMatchWinProb} shirtsWon={shirtsWon} />
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
          {hasProjections && (
            <>
              <WinProbabilityBadge winProbability={winProbability} postMatchWinProb={null} shirtsWon={shirtsWon} />
              <RatingProjectionTable
                projections={ratingProjections}
                shirts={matchPlayers.filter((p) => p.faction === 'SHIRTS')}
                skins={matchPlayers.filter((p) => p.faction === 'SKINS')}
                current={ratingCurrent}
              />
            </>
          )}
        </>
      )}

      {tab === 'advanced' && statsRecorded && (
        <SabremetricsLeaderboardView rows={advancedStatRows} teamGroups={advancedStatTeams} showPlusStats={false} />
      )}

      {tab === 'scouting' && (
        <>
          {hasScoutingData && (
            <ScoutingReport
              shirts={[scoutingData!.shirts[0], scoutingData!.shirts[1]]}
              skins={[scoutingData!.skins[0], scoutingData!.skins[1]]}
              duos={scoutingH2H!.duos}
              rivals={scoutingH2H!.rivals}
              matchMap={matchMap}
              mapMatchIds={mapMatchIds}
              mapPool={mapPool}
              mapLeagueAverages={scoutingData!.mapLeagueAverages}
              shirtsF={shirtsF}
              skinsF={skinsF}
            />
          )}
        </>
      )}

      {tab === 'recap' && hasRecap && (
        <MatchRecapTab
          job={replayJob}
          events={replayEvents}
          matchId={matchId}
          matchMap={matchMap}
          canDispatch={canDispatchReplay}
        />
      )}

      {tab === 'recording' && (
        <div className="mt-4 flex flex-col gap-6">
          <RecordingViewer videoId={recordingURL} />
          {canEditRecording && (
            <RecordingUrlForm matchId={matchId} videoId={recordingURL} />
          )}
        </div>
      )}
    </>
  );
}
