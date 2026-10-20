import type { Metadata } from 'next';
import Link from 'next/link';
import { TopbarShell } from '@/components/TopbarShell';
import { TOOLS, toolCrumbs, toolHref } from '@/lib/tools';

export const metadata: Metadata = {
  title: 'Tools',
  description: 'Open DGLS tools for exploring league formats and data.',
};

export default function ToolsPage() {
  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={toolCrumbs()} />
      <main className="max-w-[900px] mx-auto px-4 sm:px-6 pb-16">
        <h1 className="mt-8 mb-6 font-display text-[28px] font-semibold leading-tight">Tools</h1>
        <div className="grid gap-3 sm:grid-cols-2">
          {TOOLS.map((tool) => (
            <Link
              key={tool.slug}
              href={toolHref(tool.slug)}
              className="lift-card block p-4 border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]"
            >
              <div className="font-display text-[18px] font-semibold">{tool.name}</div>
              <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1">{tool.summary}</div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
