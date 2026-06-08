'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { mapImageFor, toSentenceCase } from '@/lib/maps';
import { extractSeasonNumber, tabCls } from '@/lib/util';
import { useSeasonFilter, SeasonFilter } from './SeasonFilter';
import type { MapIndexEntry } from '@/lib/types';

type SortKey = 'name' | 'seasonsPlayed' | 'pickCount' | 'banCount' | 'noPickCount' | 'pickAndWon' | 'totalKills' | 'totalAssists';
type SortDir = 'asc' | 'desc';

function extractSeasonNums(seasons: { name: string }[]): string {
  const nums = Array.from(
    new Set(seasons.map((s) => extractSeasonNumber(s.name)).filter((n): n is number => n !== null)),
  ).sort((a, b) => a - b);
  if (nums.length === 0) return seasons.map((s) => s.name).join(' · ');
  return `Season${nums.length > 1 ? 's' : ''}: ${nums.join(', ')}`;
}


export default function MapIndexView({ maps }: { maps: MapIndexEntry[] }) {
  const [tab, setTab] = useState<'tiles' | 'stats'>('tiles');
  const [sortKey, setSortKey] = useState<SortKey>('pickCount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const { includeRegular, includeGauntlet, selectedSeason, toggleRegular, toggleGauntlet, setSelectedSeason } = useSeasonFilter();

  const allSeasons = useMemo(() => {
    const seen = new Map<number, { id: number; name: string; is_gauntlet: boolean }>();
    for (const map of maps) {
      for (const s of map.seasons) {
        if (!seen.has(s.id)) seen.set(s.id, s);
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.id - b.id);
  }, [maps]);

  // Compute per-map filtered stats from statsBySeason
  const displayStats = useMemo(() => {
    const result = new Map<string, { seasonsPlayed: number; pickCount: number; banCount: number; noPickCount: number; pickAndWon: number; totalKills: number; totalAssists: number }>();
    for (const map of maps) {
      const relevant = map.statsBySeason.filter((s) => {
        if (!includeRegular && !s.isGauntlet) return false;
        if (!includeGauntlet && s.isGauntlet) return false;
        if (selectedSeason !== 'all' && s.seasonId !== selectedSeason) return false;
        return true;
      });
      const regularPoolNums = new Set(
        map.seasons
          .filter((s) => !s.is_gauntlet)
          .map((s) => extractSeasonNumber(s.name) ?? s.id),
      );
      result.set(map.slug, {
        seasonsPlayed: regularPoolNums.size,
        pickCount: relevant.reduce((sum, s) => sum + s.pickCount, 0),
        banCount: relevant.reduce((sum, s) => sum + s.banCount, 0),
        noPickCount: relevant.reduce((sum, s) => sum + s.noPickCount, 0),
        pickAndWon: relevant.reduce((sum, s) => sum + s.pickAndWon, 0),
        totalKills: relevant.reduce((sum, s) => sum + s.totalKills, 0),
        totalAssists: relevant.reduce((sum, s) => sum + s.totalAssists, 0),
      });
    }
    return result;
  }, [maps, includeRegular, includeGauntlet, selectedSeason]);

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

  const colCls = (key: SortKey, align: 'left' | 'right' = 'right') =>
    [
      'pb-2 font-semibold tracked text-[10px] uppercase cursor-pointer select-none whitespace-nowrap',
      'hover:text-[var(--color-text-primary)] transition-colors',
      align === 'right' ? 'px-4 text-right' : 'pr-4 text-left',
      key === sortKey ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]',
    ].join(' ');

  const arrow = (key: SortKey) => key !== sortKey ? '' : sortDir === 'asc' ? ' ↑' : ' ↓';


  return (
    <>
      <div className="flex flex-wrap items-center gap-y-2 border-b border-[var(--color-border-primary)] mb-6">
        <button type="button" className={tabCls(tab === 'tiles')} onClick={() => setTab('tiles')}>
          Maps
        </button>
        <button type="button" className={tabCls(tab === 'stats')} onClick={() => setTab('stats')}>
          Statistics
        </button>
        <SeasonFilter
          filter={{ includeRegular, includeGauntlet, toggleRegular, toggleGauntlet, selectedSeason }}
          seasons={allSeasons}
          onSeasonChange={setSelectedSeason}
          className="ml-auto flex flex-wrap items-center gap-4 pb-0.5"
        />
      </div>

      {tab === 'tiles' && (
        filtered.length === 0 ? (
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">No maps for this selection.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {filtered.map((map) => {
              const img = mapImageFor(map.name);
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
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)]">No maps for this selection.</div>
        ) : (
          <table className="w-full border-collapse font-mono text-[12px]">
            <thead>
              <tr className="border-b border-[var(--color-border-primary)]">
                <th className={colCls('name', 'left')} onClick={() => handleSort('name')}>Map{arrow('name')}</th>
                <th className={colCls('seasonsPlayed')} onClick={() => handleSort('seasonsPlayed')}>Seasons{arrow('seasonsPlayed')}</th>
                <th className={colCls('pickCount')} onClick={() => handleSort('pickCount')}>Picks{arrow('pickCount')}</th>
                <th className={colCls('banCount')} onClick={() => handleSort('banCount')}>Bans{arrow('banCount')}</th>
                <th className={colCls('noPickCount')} onClick={() => handleSort('noPickCount')}>No-picks{arrow('noPickCount')}</th>
                <th className={colCls('pickAndWon')} onClick={() => handleSort('pickAndWon')}>Pick &amp; won{arrow('pickAndWon')}</th>
                <th className={colCls('totalKills')} onClick={() => handleSort('totalKills')}>Total kills{arrow('totalKills')}</th>
                <th className={colCls('totalAssists')} onClick={() => handleSort('totalAssists')}>Total assists{arrow('totalAssists')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((map) => {
                const stats = displayStats.get(map.slug);
                return (
                  <tr key={map.slug} className="lift-row border-b border-[var(--color-border-primary)]">
                    <td className="py-2 pr-4">
                      <Link href={`/maps/${map.slug}`} className="hover:text-[var(--color-text-secondary)] transition-colors">
                        {toSentenceCase(map.name)}
                      </Link>
                    </td>
                    <td className="py-2 px-4 text-right text-[var(--color-text-secondary)]">{stats?.seasonsPlayed || '—'}</td>
                    <td className="py-2 px-4 text-right text-[var(--color-text-secondary)]">{stats?.pickCount || '—'}</td>
                    <td className="py-2 px-4 text-right text-[var(--color-text-secondary)]">{stats?.banCount || '—'}</td>
                    <td className="py-2 px-4 text-right text-[var(--color-text-secondary)]">{stats?.noPickCount || '—'}</td>
                    <td className="py-2 px-4 text-right text-[var(--color-text-secondary)]">{stats?.pickAndWon || '—'}</td>
                    <td className="py-2 px-4 text-right text-[var(--color-text-secondary)]">{stats?.totalKills || '—'}</td>
                    <td className="py-2 pl-4 text-right text-[var(--color-text-secondary)]">{stats?.totalAssists || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )
      )}
    </>
  );
}
