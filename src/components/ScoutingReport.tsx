'use client';

import { useMemo, useState } from 'react';
import Th from './Th';
import { StatTable, Tr, Td, PlayerCell } from './StatTable';
import type { DuoStats, H2HStats, MapLeagueAvg, MapStat, ScoutingPlayer } from '@/lib/queries';
import { duoBlendedScorer, rivalBlendedScorer, duoBreakdownScorer, rivalBreakdownScorer, ratingPoints } from '@/lib/h2h-ratings';
import { mapSlug, toSentenceCase } from '@/lib/maps';
import { useMapLookup } from './MapContext';
import { avgOf, factionColor, tabCls } from '@/lib/util';
import { playerHref } from '@/lib/crumbs';
import { findDuo, findRival } from '@/lib/h2h';
import Link from 'next/link';
import { DuoDetail, RivalDetail, EmptyPanel } from './MatchupDetail';
import MapHeatmap from './MapHeatmap';

function h2hHref(nameA: string, nameB: string, type: 'partner' | 'opponent'): string {
  return `/statistics?tab=h2h&a=${encodeURIComponent(nameA)}&b=${encodeURIComponent(nameB)}&type=${type}`;
}

/** Returns a copy of `rival` with A/B flipped so that `desiredA` is always playerA — lets a
 *  caller pin a consistent side (the shirts player) regardless of which player `computeH2H`
 *  happened to assign as A by id ordering. */
function normalizeRival(rival: H2HStats, desiredA: number): H2HStats {
  if (rival.playerA === desiredA) return rival;
  return {
    playerA: rival.playerB,
    playerB: rival.playerA,
    meetings: rival.meetings,
    aWins: rival.bWins,
    bWins: rival.aWins,
    aUpsetScore: rival.bUpsetScore,
    bUpsetScore: rival.aUpsetScore,
    aUpsetWins: rival.bUpsetWins,
    bUpsetWins: rival.aUpsetWins,
    lastMap: rival.lastMap,
    aStats: rival.bStats,
    bStats: rival.aStats,
    mapBreakdown: rival.mapBreakdown.map((s) => ({
      ...s,
      wins: s.losses,
      losses: s.wins,
      roundsWon: s.roundsPlayed - s.roundsWon,
      aAdr: s.bAdr,
      bAdr: s.aAdr,
    })),
    matches: rival.matches.map((m) => ({
      ...m,
      aWon: m.aWon == null ? null : !m.aWon,
      aTeam: m.bTeam,
      bTeam: m.aTeam,
      score: m.score ? { a: m.score.b, b: m.score.a } : null,
    })),
  };
}

function heatTitle(val: number, baseline: number, unit: string, decimals: number): string {
  const d = val - baseline;
  const abs = Math.abs(d).toFixed(decimals);
  if (d > 0) return `+${abs}${unit} above career average`;
  if (d < 0) return `${abs}${unit} below career average`;
  return 'At career average';
}

function heatColor(val: number, baseline: number, threshold: number): string {
  const d = val - baseline;
  if (d >= threshold) return 'var(--color-accent-green-fg)';
  if (d <= -threshold) return 'var(--color-accent-red-fg)';
  return 'var(--color-text-primary)';
}

function MapCard({
  mapName,
  shirts,
  skins,
  expanded,
  leagueAvg,
}: {
  mapName: string;
  shirts: [ScoutingPlayer, ScoutingPlayer];
  skins: [ScoutingPlayer, ScoutingPlayer];
  expanded: boolean;
  leagueAvg: MapLeagueAvg | null;
}) {
  const maps = useMapLookup();
  const slug = mapSlug(mapName);
  const displayName = toSentenceCase(mapName);
  const mapImg = maps[slug]?.image_url ?? null;

  type Row = { player: ScoutingPlayer; stat: MapStat | null };
  let rows: Row[] = [...shirts, ...skins].map((p) => ({ player: p, stat: p.mapStats[slug] ?? null }));
  if (expanded) rows = [...rows].sort((a, b) => {
    const wDiff = (b.stat?.wins ?? -1) - (a.stat?.wins ?? -1);
    if (wDiff !== 0) return wDiff;
    return (a.stat?.losses ?? Infinity) - (b.stat?.losses ?? Infinity);
  });

  const withData = rows.filter((r): r is { player: ScoutingPlayer; stat: MapStat } => r.stat !== null);
  const avg = withData.length > 0
    ? {
        rwr: avgOf(withData.map((r) => r.stat.rwr)),
        adr: avgOf(withData.map((r) => r.stat.adr)),
        avgKills: avgOf(withData.map((r) => r.stat.avgKills)),
        avgDeaths: avgOf(withData.map((r) => r.stat.avgDeaths)),
        avgAssists: avgOf(withData.map((r) => r.stat.avgAssists)),
      }
    : null;

  return (
    <StatTable
      fixed
      header={
        <Link
          href={`/maps/${slug}`}
          className="map-card-bg flex items-end justify-between gap-3 px-4 py-5 border-b border-[var(--color-border-tertiary)]"
          style={mapImg ? ({ ['--map-img' as string]: `url("${mapImg}")` } as React.CSSProperties) : undefined}
        >
          <span className="map-text-scrim font-display font-bold text-[16px] text-[var(--color-text-primary)]">{displayName}</span>
          {expanded && <span className="map-text-scrim tracked text-[9px] text-[var(--color-ct)]">PICKED</span>}
        </Link>
      }
    >
      <thead>
        <tr>
          <Th>Player</Th>
          <Th align="right">W-L</Th>
          {expanded && <><Th align="right">K</Th><Th align="right">A</Th><Th align="right">D</Th></>}
          <Th align="right">RWR%</Th>
          <Th align="right">ADR</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ player, stat }) => (
          <Tr key={player.id} href={playerHref(player.id)}>
            <PlayerCell id={player.id} name={player.name} sticky={false} className="truncate" />
            {stat === null ? (
              <Td colSpan={expanded ? 6 : 3} muted>No data</Td>
            ) : (
              <>
                <Td muted>{stat.wins}-{stat.losses}</Td>
                {expanded && (
                  <>
                    <Td>{Math.round(stat.avgKills)}</Td>
                    <Td>{Math.round(stat.avgAssists)}</Td>
                    <Td>{Math.round(stat.avgDeaths)}</Td>
                  </>
                )}
                <Td style={{ color: heatColor(stat.rwr * 100, player.rwr * 100, 3) }} title={heatTitle(stat.rwr * 100, player.rwr * 100, '%', 1)}>
                  {(stat.rwr * 100).toFixed(1)}%
                </Td>
                <Td bold style={{ color: heatColor(stat.adr, player.adr, 5) }} title={heatTitle(stat.adr, player.adr, ' ADR', 1)}>
                  {stat.adr.toFixed(1)}
                </Td>
              </>
            )}
          </Tr>
        ))}
        {avg && (
          <>
            <Tr variant="summary">
              <Td align="left" mono={false} muted className="tracked">players</Td>
              <Td muted>—</Td>
              {expanded && (
                <>
                  <Td muted title="Avg of Players K">{avg.avgKills.toFixed(1)}</Td>
                  <Td muted title="Avg of Players A">{avg.avgAssists.toFixed(1)}</Td>
                  <Td muted title="Avg of Players D">{avg.avgDeaths.toFixed(1)}</Td>
                </>
              )}
              <Td muted title="Avg of Players RWR%">{(avg.rwr * 100).toFixed(1)}%</Td>
              <Td muted title="Avg of Players ADR">{avg.adr.toFixed(1)}</Td>
            </Tr>
            <Tr variant="summary">
              <Td align="left" mono={false} muted className="tracked">league</Td>
              <Td muted title={leagueAvg ? `Games played on ${displayName} by the league` : undefined}>{leagueAvg ? leagueAvg.wins + leagueAvg.losses : '—'}</Td>
              {expanded && (
                <>
                  <Td muted title="Avg of League K">{leagueAvg ? leagueAvg.avgKills.toFixed(1) : '—'}</Td>
                  <Td muted title="Avg of League A">{leagueAvg ? leagueAvg.avgAssists.toFixed(1) : '—'}</Td>
                  <Td muted title="Avg of League D">{leagueAvg ? leagueAvg.avgDeaths.toFixed(1) : '—'}</Td>
                </>
              )}
              <Td muted>—</Td>
              <Td muted title="Avg of League ADR">{leagueAvg ? leagueAvg.adr.toFixed(1) : '—'}</Td>
            </Tr>
          </>
        )}
      </tbody>
    </StatTable>
  );
}

type Faction = 'CT' | 'T' | null;

export default function ScoutingReport({
  shirts,
  skins,
  duos,
  rivals,
  matchMap,
  mapMatchIds = [],
  mapPool,
  mapLeagueAverages,
  shirtsF,
  skinsF,
}: {
  shirts: [ScoutingPlayer, ScoutingPlayer];
  skins: [ScoutingPlayer, ScoutingPlayer];
  duos: DuoStats[];
  rivals: H2HStats[];
  matchMap: string | null;
  mapMatchIds?: number[];
  mapPool: string[] | null;
  mapLeagueAverages: Record<string, MapLeagueAvg>;
  shirtsF: Faction;
  skinsF: Faction;
}) {
  const allPlayers = [...shirts, ...skins];
  const playersById = new Map(allPlayers.map((p) => [p.id, p]));

  const shirtsDuo = findDuo(duos, shirts[0].id, shirts[1].id);
  const skinsDuo = findDuo(duos, skins[0].id, skins[1].id);
  const scoreDuo = duoBlendedScorer(duos);
  const scoreRival = rivalBlendedScorer(rivals);
  const breakdownDuo = duoBreakdownScorer(duos);
  const breakdownRival = rivalBreakdownScorer(rivals);

  function findNormalized(shirtId: number, skinId: number): H2HStats | undefined {
    const r = findRival(rivals, shirtId, skinId);
    return r ? normalizeRival(r, shirtId) : undefined;
  }

  // columns = shirts[0], shirts[1] — rows = skins[0], skins[1]
  // Rivals are normalized so the shirt player is always playerA (left/T side) and skins player is playerB (right/CT side).
  const rivalCells: Array<{ shirt: ScoutingPlayer; skin: ScoutingPlayer; rival: H2HStats | undefined }> = [
    { shirt: shirts[0], skin: skins[0], rival: findNormalized(shirts[0].id, skins[0].id) },
    { shirt: shirts[1], skin: skins[0], rival: findNormalized(shirts[1].id, skins[0].id) },
    { shirt: shirts[0], skin: skins[1], rival: findNormalized(shirts[0].id, skins[1].id) },
    { shirt: shirts[1], skin: skins[1], rival: findNormalized(shirts[1].id, skins[1].id) },
  ];

  // Sub-tabs split the people-intel (Friends/Rivals) from the map-intel (per-map stat
  // cards + the picked map's heatmap), keeping each view focused (#128).
  const [sub, setSub] = useState<'scouting' | 'map'>('scouting');
  // Stable identity so MapHeatmap's filter memo doesn't churn each render.
  const visibleMatchIds = useMemo(() => new Set(mapMatchIds), [mapMatchIds]);

  return (
    <div className="mt-6">
      <div role="tablist" className="flex items-center gap-2 mb-4 border-b border-[var(--color-border-primary)]">
        <button role="tab" aria-selected={sub === 'scouting'} type="button" className={tabCls(sub === 'scouting')} onClick={() => setSub('scouting')}>
          H2H
        </button>
        <button role="tab" aria-selected={sub === 'map'} type="button" className={tabCls(sub === 'map')} onClick={() => setSub('map')}>
          Map Intel
        </button>
      </div>

      {sub === 'scouting' && (
        <>
          <div className="tracked text-[10px] mb-4" style={{ letterSpacing: '0.2em' }}>
            <span className="text-[var(--color-ct)]">Scouting Report</span>
            <span className="text-[var(--color-text-secondary)] mx-2">—</span>
            <span className="text-[var(--color-ct)]">Friends</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            {shirtsDuo
              ? <DuoDetail duo={shirtsDuo} players={playersById} minimal headerLabel="Shirts" headerColor={factionColor(shirtsF)} statsHref={h2hHref(shirts[0].name, shirts[1].name, 'partner')} friendshipRating={ratingPoints(scoreDuo(shirtsDuo))} ratingBreakdown={breakdownDuo(shirtsDuo)} />
              : <EmptyPanel label={`Shirts (${shirts[0].name} & ${shirts[1].name}) — no history yet`} />}
            {skinsDuo
              ? <DuoDetail duo={skinsDuo} players={playersById} minimal headerLabel="Skins" headerColor={factionColor(skinsF)} statsHref={h2hHref(skins[0].name, skins[1].name, 'partner')} friendshipRating={ratingPoints(scoreDuo(skinsDuo))} ratingBreakdown={breakdownDuo(skinsDuo)} />
              : <EmptyPanel label={`Skins (${skins[0].name} & ${skins[1].name}) — no history yet`} />}
          </div>

          <div className="tracked text-[10px] mt-6 mb-4" style={{ letterSpacing: '0.2em' }}>
            <span className="text-[var(--color-t)]">Scouting Report</span>
            <span className="text-[var(--color-text-secondary)] mx-2">—</span>
            <span className="text-[var(--color-t)]">Rivals</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            {rivalCells.map(({ shirt, skin, rival }) =>
              rival ? (
                <RivalDetail key={`${rival.playerA}-${rival.playerB}`} rival={rival} players={playersById} minimal statsHref={h2hHref(shirt.name, skin.name, 'opponent')} rivalryRating={ratingPoints(scoreRival(rival))} ratingBreakdown={breakdownRival(rival)} />
              ) : (
                <EmptyPanel key={`${shirt.id}-${skin.id}`} label={`${shirt.name} vs ${skin.name} — no history yet`} />
              ),
            )}
          </div>
        </>
      )}

      {sub === 'map' && (
        <div className="flex flex-col gap-6">
          {(() => {
            const pickedSlug = matchMap ? mapSlug(matchMap) : null;
            const pool = (mapPool && mapPool.length > 0) ? mapPool : matchMap ? [matchMap] : null;
            if (!pool) return null;
            const mapsToShow = pickedSlug ? [matchMap!] : pool;
            return (
              <div className="flex flex-col gap-2.5">
                <div className="tracked text-[10px] mb-2" style={{ letterSpacing: '0.2em' }}>
                  <span className="text-[var(--color-ct)]">Map Intel</span>
                </div>
                <div className={pickedSlug ? 'flex flex-col gap-2.5' : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5'}>
                  {mapsToShow.map((m) => (
                    <MapCard
                      key={mapSlug(m)}
                      mapName={m}
                      shirts={shirts}
                      skins={skins}
                      expanded={pickedSlug !== null}
                      leagueAvg={mapLeagueAverages[mapSlug(m)] ?? null}
                    />
                  ))}
                </div>
              </div>
            );
          })()}

          {matchMap && (
            <div className="flex flex-col gap-2.5">
              <div className="tracked text-[10px] mb-2" style={{ letterSpacing: '0.2em' }}>
                <span className="text-[var(--color-t)]">{toSentenceCase(matchMap)} Heatmap</span>
              </div>
              <MapHeatmap slug={mapSlug(matchMap)} matchIds={mapMatchIds} visibleMatchIds={visibleMatchIds} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
