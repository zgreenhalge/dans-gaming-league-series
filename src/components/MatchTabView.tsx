'use client';

import { useState } from 'react';
import Link from 'next/link';
import { tabCls, formatEhogDelta } from '@/lib/util';
import PlayerAvatar from '@/components/PlayerAvatar';
import { YouBadge } from '@/components/YouBadge';
import DemoUploadModal from '@/components/DemoUploadModal';
import ScoutingReport from '@/components/ScoutingReport';
import type { MatchStatRow, MatchScoutingData, H2HData } from '@/lib/queries';
import type { RatingProjection } from '@/lib/ehog';

type Faction = 'CT' | 'T' | null;
type Tab = 'leaderboard' | 'scouting';

function factionClass(f: Faction): string {
  if (f === 'CT') return 'faction-ct';
  if (f === 'T') return 'faction-t';
  return '';
}

function Scoreboard({
  players,
  mvpPlayerId,
  faction,
  currentPlayerId,
  ratingDeltas,
}: {
  players: MatchStatRow[];
  mvpPlayerId: number | null;
  faction: Faction;
  currentPlayerId: number | null;
  ratingDeltas: Record<number, number>;
}) {
  const cls = factionClass(faction);
  return (
    <div className={`border border-[var(--color-border-primary)] overflow-hidden faction-tint ${cls}`}>
      <table className="w-full table-fixed border-collapse text-[13px]">
        <thead>
          <tr className="bg-[var(--color-bg-secondary)]">
            <th className="tracked text-[10px] font-semibold text-[var(--color-text-secondary)] text-left pl-4 pr-3 py-2.5 border-b border-[var(--color-border-primary)]">
              Player
            </th>
            {(['K', 'A', 'D'] as const).map((h) => (
              <th
                key={h}
                className="tracked text-[10px] font-semibold text-[var(--color-text-secondary)] text-right px-3 py-2.5 border-b border-[var(--color-border-primary)] w-10"
              >
                {h}
              </th>
            ))}
            <th className="tracked text-[10px] font-semibold text-[var(--color-text-secondary)] text-right px-3 py-2.5 border-b border-[var(--color-border-primary)] w-16">
              DMG
            </th>
            <th className="tracked text-[10px] font-semibold text-[var(--color-text-secondary)] text-right px-3 py-2.5 border-b border-[var(--color-border-primary)] w-14">
              ADR
            </th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => {
            const playedRow = p.rounds_played > 0;
            const dash = (v: string) =>
              playedRow ? v : <span className="text-[var(--color-text-secondary)]">—</span>;
            return (
              <tr
                key={p.player_id}
                className="lift-row border-b border-[var(--color-border-tertiary)] last:border-b-0 cursor-pointer"
              >
                <td className="pl-3 pr-3 py-2 font-display font-semibold faction-fg">
                  <Link href={`/players/${p.player_id}`} className="flex items-center gap-2.5">
                    <PlayerAvatar name={p.player_name} imageUrl={p.steam_avatar_url} size="sm" />
                    {p.player_name}
                    {currentPlayerId !== null && p.player_id === currentPlayerId && <YouBadge />}
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
                <td className="px-3 py-2.5 text-right font-mono tnum">{dash(String(p.kills))}</td>
                <td className="px-3 py-2.5 text-right font-mono tnum">{dash(String(p.assists))}</td>
                <td className="px-3 py-2.5 text-right font-mono tnum">{dash(String(p.deaths))}</td>
                <td className="px-3 py-2.5 text-right font-mono tnum">{dash(p.damage.toLocaleString())}</td>
                <td className="px-3 pr-4 py-2.5 text-right font-mono tnum font-semibold">
                  {dash(String(Math.round(p.adr)))}
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
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[var(--color-bg-secondary)]">
              <th className="tracked text-[9px] font-semibold py-2 pl-4 pr-3 border-b border-[var(--color-border-primary)] text-left text-[var(--color-text-secondary)]">
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
                <tr key={proj.label} className="lift-row border-b border-[var(--color-border-tertiary)] last:border-b-0">
                  <td className="pl-4 pr-3 py-2.5 font-mono tnum text-[var(--color-text-secondary)] whitespace-nowrap">
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
}) {
  const hasScoutingData = !!(scoutingData && scoutingH2H);
  const hasProjections = ratingProjections.length > 0;
  const [tab, setTab] = useState<Tab>('leaderboard');

  const allStats = [...shirts, ...skins];
  const statsRecorded = allStats.length > 0;

  return (
    <>
      <div className="mt-10 flex items-center justify-between mb-2">
        <div className="flex gap-1">
          <button type="button" className={tabCls(tab === 'leaderboard')} onClick={() => setTab('leaderboard')}>
            Scoreboard
          </button>
          {(hasScoutingData || hasProjections) && (
            <button type="button" className={tabCls(tab === 'scouting')} onClick={() => setTab('scouting')}>
              Scouting Report
            </button>
          )}
        </div>
        {tab === 'leaderboard' && (
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
                initialStats={allStats.length > 0 ? allStats : undefined}
                initialShirtsScore={score?.shirts ?? null}
                initialSkinsScore={score?.skins ?? null}
              />
            )}
          </div>
        )}
      </div>

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
                <Scoreboard players={shirts} mvpPlayerId={mvpPlayerId} faction={shirtsF} currentPlayerId={currentPlayerId} ratingDeltas={ratingDeltas} />
              </div>
              <div className="mt-6">
                <TeamHeader
                  name="Skins"
                  faction={skinsF}
                  score={score?.skins ?? null}
                  outcome={score ? (!shirtsWon ? 'WON' : 'LOST') : null}
                />
                <Scoreboard players={skins} mvpPlayerId={mvpPlayerId} faction={skinsF} currentPlayerId={currentPlayerId} ratingDeltas={ratingDeltas} />
              </div>
            </>
          )}

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
