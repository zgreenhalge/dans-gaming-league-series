import { TopbarShell } from '@/components/TopbarShell';
import { getCareerH2HDataCached, computeDuoMaxes, computeRivalMaxes } from '@/lib/queries';
import { FriendsCalculator, RivalCalculator } from '@/components/FriendsRivalCalculator';
import { WinProbabilityCalculator } from '@/components/WinProbabilityCalculator';

export const revalidate = 60;
export const metadata = {
  title: 'For Nerds',
  description: 'The real formulas behind Friends Rating, Rival Rating, and EHOG — plus live calculators.',
};

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-display text-[20px] font-semibold mt-10 mb-3 first:mt-0">{children}</div>
  );
}

const formula = 'font-mono text-[13px] bg-[var(--color-bg-secondary)] border border-[var(--color-border-tertiary)] rounded px-3 py-2 my-3 whitespace-pre-wrap';

export default async function ForNerdsPage() {
  const { duos, rivals } = await getCareerH2HDataCached();
  const duoMaxes = computeDuoMaxes(duos);
  const rivalMaxes = computeRivalMaxes(rivals);

  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={[{ label: 'DGLS', href: '/' }, { label: 'Docs', href: '/docs' }, { label: 'For Nerds' }]} />
      <main className="max-w-[860px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <div className="font-display text-[36px] font-semibold leading-tight">For Nerds</div>
          <p className="mt-2 text-[14px] text-[var(--color-text-secondary)]">
            The actual math behind the site&rsquo;s narrative ratings, and calculators that run the
            real formulas against the league&rsquo;s current numbers.
          </p>
        </div>

        <div className="text-[15px] leading-relaxed text-[var(--color-text-secondary)]">
          <SectionHeading>Friends Rating</SectionHeading>
          <p>
            How strong a duo&rsquo;s partnership is, blended from three signals and normalized
            against the best any duo in the league has posted in each — so no single stat (like raw
            games played) dominates the score on its own.
          </p>
          <div className={formula}>
            {'Friends Rating = 0.5·(games / maxGames)² + 0.3·(winRate / maxWinRate)² + 0.2·(rwr / maxRwr)²'}
          </div>
          <p>
            <code>games</code> and <code>winRate</code> are the duo&rsquo;s own games played and win
            rate as teammates; <code>rwr</code> is their round win rate together. Every{' '}
            <code>max…</code> is the highest value <em>any</em> duo in the league has posted for that
            metric right now.
          </p>
          <FriendsCalculator maxes={duoMaxes} />

          <SectionHeading>Rival Rating</SectionHeading>
          <p>
            How close a rivalry is — rewarding pairs who&rsquo;ve played each other a lot and split
            those meetings closely, rather than one side dominating.
          </p>
          <div className={formula}>
            {'Rival Rating = 0.5·(meetings / maxMeetings)² + 0.3·(1 − winDiff / maxWinDiff)² + 0.2·(1 − roundDiffPerGame / maxRoundDiff)²'}
          </div>
          <p>
            <code>winDiff</code> is the absolute gap between the two players&rsquo; wins against each
            other; <code>roundDiffPerGame</code> is their absolute round-won gap per meeting. Both
            terms are inverted (closer to 0 gap scores higher) since this rating rewards evenly
            matched rivalries.
          </p>
          <RivalCalculator maxes={rivalMaxes} />

          <SectionHeading>EHOG (skill rating)</SectionHeading>
          <p>
            EHOG isn&rsquo;t a plug-in-your-stats formula — it&rsquo;s an{' '}
            <a href="https://github.com/philihp/openskill.js" className="underline hover:text-[var(--color-text-primary)]">
              OpenSkill
            </a>{' '}
            (PlackettLuce) rating that updates from match outcomes alone (who won, and by how much),
            recomputed chronologically over a player&rsquo;s full match history rather than derived
            from any single game&rsquo;s stat line. The underlying model tracks a skill estimate (μ)
            and an uncertainty (σ) per player, then maps them onto the 10&ndash;100 scale shown on the
            leaderboard:
          </p>
          <div className={formula}>{'EHOG = 10 + 90 / (1 + exp(−(μ − λσ − center) / scale))'}</div>
          <p>
            What <em>is</em> a genuine formula — given two teams&rsquo; current ratings, no history
            replay required — is the pre-match win probability the match page itself shows, straight
            from OpenSkill&rsquo;s own predictor:
          </p>
          <WinProbabilityCalculator />
        </div>
      </main>
    </div>
  );
}
