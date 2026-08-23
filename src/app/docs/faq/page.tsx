import { TopbarShell } from '@/components/TopbarShell';

export const metadata = {
  title: 'FAQ',
  description: 'Answers to common DGLS questions — linking Discord, joining your match, and how the league runs week to week.',
};

function FaqItem({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group border-b border-[var(--color-border-tertiary)] py-4">
      <summary className="cursor-pointer list-none font-display text-[16px] font-semibold flex items-center justify-between gap-3">
        {q}
        <span className="text-[var(--color-text-secondary)] transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="mt-3 text-[14px] leading-relaxed text-[var(--color-text-secondary)] space-y-2">
        {children}
      </div>
    </details>
  );
}

export default function FaqPage() {
  return (
    <div className="min-h-screen">
      <TopbarShell crumbs={[{ label: 'DGLS', href: '/' }, { label: 'Docs', href: '/docs' }, { label: 'FAQ' }]} />
      <main className="max-w-[760px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <div className="font-display text-[36px] font-semibold leading-tight">FAQ</div>
        </div>

        <div>
          <FaqItem q="How do I join my match server?">
            <p>
              Once both sides finish the map veto, a server starts automatically — no need to ask an
              admin. Open your match page and look for the <strong>Match server</strong> card: it
              shows a spinner while the server boots, then swaps to a <strong>Join server</strong>{' '}
              button the moment it&rsquo;s ready. If the button doesn&rsquo;t launch Steam directly,
              use the <strong>Copy &ldquo;connect …&rdquo;</strong> button underneath it and paste
              the command into your in-game console.
            </p>
          </FaqItem>

          <FaqItem q="I can't connect, or the server seems stuck — what do I do?">
            <p>
              If the card is still showing the starting spinner after a few minutes, or shows a
              failed state, an admin can retry it from the same card. Try the copy-connect fallback
              above before assuming the server itself is broken — most connection issues are the
              Steam client&rsquo;s direct-launch link, not the server. If neither works, ping an
              admin in Discord.
            </p>
          </FaqItem>

          <FaqItem q="How do I link my Discord account?">
            <p>
              Open your player profile and click <strong>Link Discord</strong>. You&rsquo;ll be sent
              to Discord&rsquo;s own consent screen — approving it links your account, no password
              or extra info shared beyond your Discord user id. Linking also creates a
              cosmetic name-color role for you in the league&rsquo;s Discord, which you can set
              yourself with the <code>/name-color</code> slash command. You can unlink at any time
              from the same spot on your profile.
            </p>
          </FaqItem>

          <FaqItem q="How do rosters work week to week?">
            <p>
              DGLS is an <strong>Individual Rotating Mixer</strong> — you sign up as yourself, not as
              part of a fixed team. Each week the season&rsquo;s players are redrawn into two ad-hoc
              factions (SHIRTS and SKINS), so your teammate changes from week to week. With an
              odd-numbered roster, byes rotate through the players so the same person doesn&rsquo;t
              sit out repeatedly.
            </p>
          </FaqItem>

          <FaqItem q="How does the gauntlet (playoffs) work?">
            <p>
              A completed regular season feeds a companion gauntlet — a single-elimination bracket
              seeded from that season&rsquo;s final standings. The bracket is built out of pods of
              four players playing two games apiece, guaranteeing one clean 2-0 and one 0-2 out of
              every pod. Top seeds can draw a bye straight into a later round; the leaderboard on
              your season page shows a live preview of who&rsquo;s projected for a bye once the
              regular season is far enough along.
            </p>
          </FaqItem>

          <FaqItem q="I can't make my scheduled match — what should I do?">
            <p>
              Reach out in Discord as soon as you know, so your match can be rescheduled or a sub
              can be arranged. The sooner the better — a match that goes completely unplayed is
              harder to make fair for everyone else in the rotation.
            </p>
          </FaqItem>
        </div>
      </main>
    </div>
  );
}
