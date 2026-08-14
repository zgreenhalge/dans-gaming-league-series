'use client';

// Discord account linking (#394), shown only on a player's own profile page. Linking is a
// full-page redirect through Discord's OAuth2 consent screen (/api/auth/discord/link → callback),
// so there's no fetch/loading state for that half — the page just re-renders server-side with a
// fresh discord_id once Discord redirects back to /players/[id]?discord=<status>. `feedback` is
// read server-side by the page (not via useSearchParams here) so this component doesn't need a
// Suspense boundary. Unlinking is a plain DELETE, no redirect involved.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const FEEDBACK: Record<string, { message: string; isError?: boolean }> = {
  linked: { message: 'Discord linked.' },
  denied: { message: 'Discord link cancelled.', isError: true },
  taken: { message: 'That Discord account is already linked to another player.', isError: true },
  error: { message: 'Something went wrong linking Discord. Try again.', isError: true },
};

export default function DiscordLinkButton({
  linked,
  feedback,
}: {
  linked: boolean;
  feedback?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `feedback` reflects the URL's ?discord= status at load time — it doesn't update itself when
  // Unlink changes the linked state client-side, so a successful unlink dismisses it locally
  // rather than leaving a stale "Discord linked." message next to a now-unlinked button.
  const [dismissed, setDismissed] = useState(false);

  const feedbackEntry = !dismissed && feedback ? FEEDBACK[feedback] : null;

  async function unlink() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/players/me/discord', { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Failed to unlink');
        return;
      }
      setDismissed(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 font-mono text-[12px]">
      {linked ? (
        <>
          <span className="text-[var(--color-text-secondary)]">Discord linked ✓</span>
          <button
            onClick={unlink}
            disabled={busy}
            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors underline disabled:opacity-40"
          >
            {busy ? 'Unlinking…' : 'Unlink'}
          </button>
        </>
      ) : (
        <Link
          href="/api/auth/discord/link"
          className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors underline"
        >
          Link Discord
        </Link>
      )}
      {error && <span className="text-[var(--color-accent-red-fg,#f87171)]">{error}</span>}
      {!error && feedbackEntry && (
        <span
          className={
            feedbackEntry.isError
              ? 'text-[var(--color-accent-red-fg,#f87171)]'
              : 'text-[var(--color-accent-green-fg)]'
          }
        >
          {feedbackEntry.message}
        </span>
      )}
    </div>
  );
}
