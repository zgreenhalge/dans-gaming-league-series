import type { Metadata } from 'next';
import { TopbarShell } from '@/components/TopbarShell';
import { GauntletPreviewView } from '@/components/GauntletPreviewView';
import { getGauntletPreviewData } from '@/lib/queries';
import { getTool, toolCrumbs } from '@/lib/tools';

export const revalidate = 60;

const tool = getTool('gauntlet-preview');

export const metadata: Metadata = {
  title: tool.name,
  description: tool.summary,
};

// Read-only: brackets are built in the browser from a qualifier count and never saved.
export default async function GauntletPreviewPage() {
  const seasons = await getGauntletPreviewData();
  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={toolCrumbs(tool)} />
      <main className="max-w-[1100px] mx-auto px-4 sm:px-6 pb-16">
        <h1 className="mt-8 mb-6 font-display text-[28px] font-semibold leading-tight">{tool.name}</h1>
        <GauntletPreviewView seasons={seasons} />
      </main>
    </div>
  );
}
