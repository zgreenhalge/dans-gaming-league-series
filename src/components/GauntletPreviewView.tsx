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
import { SELECT_CLS } from './adminButtonStyles';

const DEFAULT_QUALIFIERS = 12;

const FATE_LABEL: Record<SeedFate, string> = { bye: 'Bye to the final', plays: 'Plays in', relegated: 'Relegated' };

export function GauntletPreviewView({ seasons }: { seasons: GauntletPreviewSeason[] }) {
  const [seasonId, setSeasonId] = useState<number | null>(null);
  const [qualifiers, setQualifiers] = useState(DEFAULT_QUALIFIERS);

  const season = seasons.find((s) => s.seasonId === seasonId) ?? null;
  const preview = useMemo(() => buildGauntletPreview(qualifiers, season?.standings ?? []), [qualifiers, season]);

  function loadSeason(value: string) {
    const next = seasons.find((s) => s.seasonId === Number(value)) ?? null;
    setSeasonId(next?.seasonId ?? null);
    if (next) setQualifiers(qualifierCountFor(next.standings));
  }

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <Stepper label="Qualifiers" value={qualifiers} min={GAUNTLET_MIN_QUALIFIERS} max={GAUNTLET_MAX_QUALIFIERS} onChange={setQualifiers} />
        {seasons.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="tracked text-[10px] text-[var(--color-text-secondary)]">Seed names</span>
            <select aria-label="Load a regular season's standings for named seeds" className={`${SELECT_CLS} h-8`} value={seasonId ?? ''} onChange={(e) => loadSeason(e.target.value)}>
              <option value="">Numbered seeds only</option>
              {seasons.map((s) => (
                <option key={s.seasonId} value={s.seasonId}>
                  {s.label} standings ({s.standings.length})
                </option>
              ))}
            </select>
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
                <Td align="left" mono={false} bold={row.fate === 'bye'} muted={row.fate === 'relegated'}>
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
