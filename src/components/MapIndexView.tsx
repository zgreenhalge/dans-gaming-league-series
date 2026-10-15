'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { toSentenceCase } from '@/lib/maps';
import { useMapLookup } from './MapContext';
import { extractSeasonNumber, tabCls, splitSeasonsByGauntlet } from '@/lib/util';
import { aggregateMapIndexStats } from '@/lib/mapSideStats';
import { useSeasonFilter, SeasonFilter } from './SeasonFilter';
import TabBar from './TabBar';
import EmptyState from './EmptyState';
import SortableTh from './SortableTh';
import { StatTable, Tr, Td, NameTd } from './StatTable';
import type { MapIndexEntry } from '@/lib/types';

type SortKey = 'name' | 'seasonsPlayed' | 'pickCount' | 'banCount' | 'noPickCount' | 'pickAndWon' | 'totalKills' | 'totalAssists' | 'avgRounds';
type SortDir = 'asc' | 'desc';

function extractSeasonNums(seasons: { name: string }[]): string {
  const nums = Array.from(
    new Set(seasons.map((s) => extractSeasonNumber(s.name)).filter((n): n is number => n !== null)),
  ).sort((a, b) => a - b);
  if (nums.length === 0) return seasons.map((s) => s.name).join(' · ');
  return `Season${nums.length > 1 ? 's' : ''}: ${nums.join(', ')}`;
}


export default function MapIndexView({ maps }: { maps: MapIndexEntry[] }) {
  const mapLookup = useMapLookup();
  const [tab, setTab] = useState<'tiles' | 'stats'>('tiles');
  const [sortKey, setSortKey] = useState<SortKey>('pickCount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const allSeasons = useMemo(() => {
    const seen = new Map<number, { id: number; name: string; is_gauntlet: boolean }>();
    for (const map of maps) {
      for (const s of map.seasons) {
        if (!seen.has(s.id)) seen.set(s.id, s);
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.id - b.id);
  }, [maps]);

  // Split for `useSeasonFilter`'s validity check below — it needs regular/gauntlet apart, not the
  // single flagged list `SeasonFilter`'s own dropdown takes.
  const { regularSeasons, gauntletSeasons } = useMemo(() => splitSeasonsByGauntlet(allSeasons), [allSeasons]);

  const { includeRegular, includeGauntlet, selectedSeason, toggleRegular, toggleGauntlet, setSelectedSeason } = useSeasonFilter({ regularSeasons, gauntletSeasons });

  // Per-map filtered stats, rolled up from statsBySeason.
  const displayStats = useMemo(
    () => aggregateMapIndexStats(maps, { includeRegular, includeGauntlet, selectedSeason }),
    [maps, includeRegular, includeGauntlet, selectedSeason],
  );

  const filtered = useMemo(() => {
    return maps.filter((map) => {
      if (map.seasons.length === 0) return selectedSeason === 'all';
      return map.seasons.some((s) => {
        if (!includeRegular && !s.is_gauntlet) return false;
        if (!includeGauntlet && s.is_gauntlet) return false;
        if (selectedSeason !== 'all' && s.id !== selectedSeason) return false;
        return true;
      });
    });
  }, [maps, includeRegular, includeGauntlet, selectedSeason]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  }

  const sorted = useMemo(() => [...maps].sort((a, b) => {
    if (sortKey === 'name') {
      const av = toSentenceCase(a.name);
      const bv = toSentenceCase(b.name);
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    const av = displayStats.get(a.slug)?.[sortKey] ?? 0;
    const bv = displayStats.get(b.slug)?.[sortKey] ?? 0;
    return sortDir === 'asc' ? av - bv : bv - av;
  }), [maps, sortKey, sortDir, displayStats]);

  const sortState = { col: sortKey, asc: sortDir === 'asc' };

  return (
    <>
      <TabBar
        bordered
        className="mb-6"
        controls={
          <SeasonFilter
            filter={{ includeRegular, includeGauntlet, toggleRegular, toggleGauntlet, selectedSeason }}
            seasons={allSeasons}
            onSeasonChange={setSelectedSeason}
          />
        }
      >
        <button role="tab" aria-selected={tab === 'tiles'} type="button" className={tabCls(tab === 'tiles')} onClick={() => setTab('tiles')}>
          Maps
        </button>
        <button role="tab" aria-selected={tab === 'stats'} type="button" className={tabCls(tab === 'stats')} onClick={() => setTab('stats')}>
          Statistics
        </button>
      </TabBar>

      {tab === 'tiles' && (
        filtered.length === 0 ? (
          <EmptyState message="No maps for this selection." />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {filtered.map((map) => {
              const img = mapLookup[map.slug]?.image_url ?? null;
              const stats = displayStats.get(map.slug);
              return (
                <Link
                  key={map.slug}
                  href={`/maps/${map.slug}`}
                  className="lift-card relative block overflow-hidden border border-[var(--color-border-primary)] aspect-[4/3] group"
                >
                  {img ? (
                    <>
                      <div
                        className="absolute inset-0 bg-cover bg-center transition-transform duration-300 group-hover:scale-105"
                        style={{ backgroundImage: `url("${img}")` }}
                      />
                      <div className="absolute inset-0 bg-black/45 group-hover:bg-black/35 transition-colors" />
                    </>
                  ) : (
                    <div className="absolute inset-0 bg-[var(--color-bg-secondary)] group-hover:bg-[var(--color-bg-tertiary,var(--color-bg-secondary))] transition-colors" />
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent pt-6 pb-3 px-3">
                    <div className="font-display text-[17px] font-semibold leading-tight text-white">
                      {toSentenceCase(map.name)}
                    </div>
                    <div className="font-mono text-[10px] text-white/70 mt-1">
                      <span>{stats?.pickCount ?? map.pickCount} picks</span>
                    </div>
                    {map.seasons.length > 0 && (
                      <div className="font-mono text-[9px] text-white/50 mt-0.5">
                        {extractSeasonNums(map.seasons)}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )
      )}

      {tab === 'stats' && (
        sorted.length === 0 ? (
          <EmptyState message="No maps for this selection." />
        ) : (
          <StatTable>
            <thead>
              <tr>
                <SortableTh label="Map" sortKey="name" state={sortState} onSort={handleSort} />
                <SortableTh label="Seasons" sortKey="seasonsPlayed" state={sortState} onSort={handleSort} align="right" />
                <SortableTh label="Picks" sortKey="pickCount" state={sortState} onSort={handleSort} align="right" />
                <SortableTh label="Bans" sortKey="banCount" state={sortState} onSort={handleSort} align="right" />
                <SortableTh label="No-picks" sortKey="noPickCount" state={sortState} onSort={handleSort} align="right" />
                <SortableTh label="Pick &amp; won" sortKey="pickAndWon" state={sortState} onSort={handleSort} align="right" />
                <SortableTh label="Total kills" sortKey="totalKills" state={sortState} onSort={handleSort} align="right" />
                <SortableTh label="Total assists" sortKey="totalAssists" state={sortState} onSort={handleSort} align="right" />
                <SortableTh label="Avg rounds" sortKey="avgRounds" state={sortState} onSort={handleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((map) => {
                const stats = displayStats.get(map.slug);
                return (
                  <Tr key={map.slug} clickable>
                    <NameTd>
                      <Link href={`/maps/${map.slug}`} className="hover:text-[var(--color-text-secondary)] transition-colors">
                        {toSentenceCase(map.name)}
                      </Link>
                    </NameTd>
                    <Td muted>{stats?.seasonsPlayed || '—'}</Td>
                    <Td muted>{stats?.pickCount || '—'}</Td>
                    <Td muted>{stats?.banCount || '—'}</Td>
                    <Td muted>{stats?.noPickCount || '—'}</Td>
                    <Td muted>{stats?.pickAndWon || '—'}</Td>
                    <Td muted>{stats?.totalKills || '—'}</Td>
                    <Td muted>{stats?.totalAssists || '—'}</Td>
                    <Td muted>{stats?.pickCount ? stats.avgRounds.toFixed(1) : '—'}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </StatTable>
        )
      )}
    </>
  );
}
