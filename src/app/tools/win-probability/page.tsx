import type { Metadata } from 'next';
import { TopbarShell } from '@/components/TopbarShell';
import { WinProbabilityCalculator } from '@/components/WinProbabilityCalculator';
import { getWinProbabilityData } from '@/lib/queries';
import { getTool, toolCrumbs } from '@/lib/tools';

export const revalidate = 60;

const tool = getTool('win-probability');

export const metadata: Metadata = {
  title: tool.name,
  description: tool.summary,
};

// Read-only: odds are computed in the browser from this data and never saved.
export default async function WinProbabilityPage() {
  const data = await getWinProbabilityData();
  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={toolCrumbs(tool)} />
      <main className="max-w-[1100px] mx-auto px-4 sm:px-6 pb-16">
        <h1 className="mt-8 mb-6 font-display text-[28px] font-semibold leading-tight">{tool.name}</h1>
        <WinProbabilityCalculator players={data.players} />
      </main>
    </div>
  );
}
