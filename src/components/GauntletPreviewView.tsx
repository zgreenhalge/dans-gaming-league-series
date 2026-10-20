'use client';

import { useMemo, useState } from 'react';
import type { GauntletPreviewSeason } from '@/lib/queries';
import { GAUNTLET_MAX_QUALIFIERS, GAUNTLET_MIN_QUALIFIERS } from '@/lib/gauntlet-bracket';
import { buildGauntletPreview, qualifierCountFor, type SeedFate } from '@/lib/gauntlet-preview';
import { GauntletBracketDiagram } from './GauntletBracketDiagram';
import { Stepper } from './Stepper';
import SectionLabel from './SectionLabel';
import Th from './Th';
import { StatTable, Td, Tr } from './StatTable';
import { SeasonFilter, useSeasonFilter } from './SeasonFilter';

const DEFAULT_QUALIFIERS = 12;

const FATE_LABEL: Record<SeedFate, string> = { bye: 'Bye to the final', plays: 'Plays in', wontQualify: "Won't qualify" };

export function GauntletPreviewView({ seasons }: { seasons: GauntletPreviewSeason[] }) {
  // Only regular seasons are offered (seeds always come from one), so the Regular/Gauntlet
  // checkboxes are hidden and `selectedSeason: 'all'` means no season is loaded: numbered seeds.
  const filterSeasons = useMemo(() => seasons.map((s) => ({ id: s.seasonId, name: s.label, is_gauntlet: false })), [seasons]);
  const filter = useSeasonFilter({ regularSeasons: filterSeasons });
  const [qualifierOverride, setQualifierOverride] = useState<number | null>(null);

  const season = seasons.find((s) => s.seasonId === filter.selectedSeason) ?? null;
  // Loading a season sets the count to its player count (clamped); the stepper then overrides it.
  const qualifiers = qualifierOverride ?? (season ? qualifierCountFor(season.standings) : DEFAULT_QUALIFIERS);
  const preview = useMemo(() => buildGauntletPreview(qualifiers, season?.standings ?? []), [qualifiers, season]);

  function selectSeason(next: number | 'all') {
    setQualifierOverride(null);
    filter.setSelectedSeason(next);
  }

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <Stepper label="Qualifiers" value={qualifiers} min={GAUNTLET_MIN_QUALIFIERS} max={GAUNTLET_MAX_QUALIFIERS} onChange={setQualifierOverride} />
        {seasons.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="tracked text-[10px] text-[var(--color-text-secondary)]">Seed names</span>
            <SeasonFilter filter={filter} seasons={filterSeasons} onSeasonChange={selectSeason} showRegular={false} showGauntlet={false} className="flex h-8 items-center" />
          </div>
        )}
        <div className="font-mono text-[12px] text-[var(--color-text-secondary)] h-8 flex items-center">
          {preview.rounds} rounds · {preview.games} games each
        </div>
      </section>

      <section>
        <SectionLabel>Bracket</SectionLabel>
        <GauntletBracketDiagram pods={preview.pods} currentPlayerId={null} seedNames={preview.seedNames} />
      </section>

      <section>
        <SectionLabel>Seeds</SectionLabel>
        <StatTable>
          <thead>
            <tr>
              <Th align="right">Seed</Th>
              <Th align="left">Player</Th>
              <Th align="left">Outcome</Th>
              <Th align="left">Enters at</Th>
            </tr>
          </thead>
          <tbody>
            {preview.seeds.map((row) => (
              <Tr key={row.seed}>
                <Td>{row.seed}</Td>
                <Td align="left" mono={false} muted={row.name === null}>
                  {row.name ?? '—'}
                </Td>
                <Td align="left" mono={false} bold={row.fate === 'bye'} muted={row.fate === 'wontQualify'}>
                  {FATE_LABEL[row.fate]}
                </Td>
                <Td align="left" mono={false} muted>
                  {row.entry}
                </Td>
              </Tr>
            ))}
          </tbody>
        </StatTable>
      </section>
    </div>
  );
}
