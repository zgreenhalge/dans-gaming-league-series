import { TopbarShell } from '@/components/TopbarShell';
import { getSeasons } from '@/lib/queries';
import { extractSeasonNumber, seasonTitle } from '@/lib/util';

export const revalidate = 60;
export const metadata = {
  title: 'About',
  description: "DGLS's mission, format, history, and charter.",
};

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-display text-[20px] font-semibold mt-10 mb-3 first:mt-0">{children}</div>
  );
}

function formatStartDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export default async function AboutPage() {
  const seasons = await getSeasons();
  const timeline = seasons
    .filter((s) => !s.is_gauntlet && s.start_date)
    .sort((a, b) => (extractSeasonNumber(a.name) ?? 999) - (extractSeasonNumber(b.name) ?? 999));

  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={[{ label: 'DGLS', href: '/' }, { label: 'Docs', href: '/docs' }, { label: 'About' }]} />
      <main className="max-w-[760px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <div className="font-display text-[36px] font-semibold leading-tight">About the League</div>
        </div>

        <div className="text-[15px] leading-relaxed text-[var(--color-text-secondary)] space-y-4">
          <SectionHeading>Manifest</SectionHeading>
          <p>
            Dan&rsquo;s Gaming League Series is a CS2 Wingman (2v2) league built around one idea:
            rosters rotate every week, so the league rewards showing up and playing well with
            whoever you&rsquo;re paired with, not just stacking a fixed team.
          </p>

          <SectionHeading>How it&rsquo;s run</SectionHeading>
          <p>
            Each regular season runs as an <strong>Individual Rotating Mixer</strong> — every player
            signs up individually, and factions (SHIRTS/SKINS) are redrawn each week rather than
            staying fixed for the season. A completed regular season feeds a companion{' '}
            <strong>gauntlet</strong>: a single-elimination playoff bracket seeded from the regular
            season&rsquo;s standings. The step-by-step mechanics — map veto, scheduling, playoffs,
            linking your Discord, connecting to your match server — live on the{' '}
            <a href="/docs/faq" className="underline hover:text-[var(--color-text-primary)]">FAQ</a>.
          </p>

          <SectionHeading>Short history</SectionHeading>
          {timeline.length === 0 ? (
            <p>No seasons recorded yet.</p>
          ) : (
            <ul className="space-y-1 font-mono text-[13px]">
              {timeline.map((s) => (
                <li key={s.id} className="flex items-baseline gap-3">
                  <span className="text-[var(--color-text-primary)] font-semibold">{seasonTitle(s.name)}</span>
                  <span>{formatStartDate(s.start_date as string)}</span>
                </li>
              ))}
            </ul>
          )}

          <SectionHeading>Charter</SectionHeading>
          <p>
            Standings are decided by the canonical sort — wins first, then round win rate, then
            average damage per round — so a single blowout never outweighs a season of consistent
            play. Byes rotate so no one sits out more than their fair share, and a player&rsquo;s
            current EHOG rating and Player Rating are informational only: neither affects seeding
            or standings.
          </p>
        </div>
      </main>
    </div>
  );
}
