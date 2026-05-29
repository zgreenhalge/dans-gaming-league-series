'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen">
      <div className="border-b-2 border-[var(--color-site-accent)] bg-[var(--color-bg-primary)]">
        <div className="max-w-[1080px] mx-auto px-6 py-3">
          <span className="font-display font-bold text-[20px]">DGLS</span>
        </div>
      </div>
      <main className="max-w-[1080px] mx-auto px-6 pb-16">
        <div className="mt-8 mb-6">
          <div className="font-display text-[36px] font-semibold leading-tight">
            Something went wrong
          </div>
          <div className="font-mono text-[12px] text-[var(--color-text-secondary)] mt-1.5">
            We hit an error talking to the database. This usually clears up on a retry.
          </div>
        </div>
        {error.digest && (
          <div className="font-mono text-[11px] text-[var(--color-text-secondary)] mb-4 tnum">
            Reference: {error.digest}
          </div>
        )}
        <div className="flex gap-3">
          <button
            onClick={reset}
            className="tracked text-[11px] font-semibold px-3 py-2 border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
          >
            Try again
          </button>
          <Link
            href="/"
            className="tracked text-[11px] font-semibold px-3 py-2 border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
          >
            Home
          </Link>
        </div>
      </main>
    </div>
  );
}
