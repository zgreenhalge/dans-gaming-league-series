'use client';

import H2HSection from './H2HSection';
import { useH2HPairUrlState } from './useH2HPairUrlState';
import type { H2HData } from '@/lib/queries';

/** A night's partner and opponent records, with the selected pair mirrored into the URL. */
export function ScrimNightH2H({ data }: { data: H2HData }) {
  const { initialPair, onPairChange } = useH2HPairUrlState(data.players);
  return <H2HSection data={data} initialPair={initialPair} onPairChange={onPairChange} />;
}
